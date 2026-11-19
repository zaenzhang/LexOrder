[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$WorkingFile,
    [Parameter(Mandatory)][AllowEmptyString()][string]$ExpectedText,
    [Parameter(Mandatory)][string]$NewText
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This acceptance step requires Windows classic Notepad.' }
$file = [IO.Path]::GetFullPath($WorkingFile)
$name = [IO.Path]::GetFileName($file)
$stem = [IO.Path]::GetFileNameWithoutExtension($file)
if ($name -notmatch '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}_.+\.txt$' -or
    -not [IO.File]::Exists($file)) { throw 'Expected an existing, app-issued synthetic TXT working copy.' }
function CanonicalText([string]$s) { $s.Replace("`r`n", "`n") }
if ([string]::Equals((CanonicalText $ExpectedText), (CanonicalText $NewText), [StringComparison]::Ordinal)) {
    throw 'The acceptance edit must change the original text.'
}
if ($ExpectedText.Length -gt 65534 -or $NewText.Length -gt 65534 -or $NewText.Contains([char]0)) {
    throw 'This acceptance helper supports small text fixtures only.'
}
if (-not [string]::Equals((CanonicalText ([IO.File]::ReadAllText($file))), (CanonicalText $ExpectedText), [StringComparison]::Ordinal)) {
    throw 'Fixture contents changed before locating the editor.'
}

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class ClassicNotepadProbe {
    [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr w, StringBuilder s, int n);
    [DllImport("user32", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string cls, string title);
    [DllImport("user32")] static extern uint GetWindowThreadProcessId(IntPtr w, out uint pid);
    [DllImport("user32")] static extern IntPtr GetMenu(IntPtr w);
    [DllImport("user32")] static extern IntPtr GetSubMenu(IntPtr menu, int i);
    [DllImport("user32")] static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32")] static extern uint GetMenuItemID(IntPtr menu, int i);
    [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetMenuString(IntPtr menu, uint item, StringBuilder s, int n, uint flags);
    [DllImport("user32", EntryPoint="SendMessageTimeoutW")] static extern IntPtr SendValue(IntPtr w, uint msg, IntPtr a, IntPtr b, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode)] static extern IntPtr SendText(IntPtr w, uint msg, IntPtr a, string b, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode)] static extern IntPtr GetText(IntPtr w, uint msg, IntPtr a, StringBuilder b, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32")] static extern bool PostMessage(IntPtr w, uint msg, IntPtr a, IntPtr b);

    public static bool Owned(IntPtr window, uint pid) {
        uint owner;
        return window != IntPtr.Zero && GetWindowThreadProcessId(window, out owner) != 0 && owner == pid;
    }
    public static IntPtr Edit(IntPtr window, uint pid) {
        var cls = new StringBuilder(128);
        if (!Owned(window, pid) || GetClassName(window, cls, cls.Capacity) == 0 || cls.ToString() != "Notepad") return IntPtr.Zero;
        var edit = FindWindowEx(window, IntPtr.Zero, "Edit", null);
        return Owned(edit, pid) ? edit : IntPtr.Zero;
    }
    public static string ReadEdit(IntPtr edit) {
        var s = new StringBuilder(65536);
        IntPtr count;
        if (GetText(edit, 0x000D, (IntPtr)s.Capacity, s, 3, 3000, out count) == IntPtr.Zero)
            throw new Exception("Could not read the visible edit control.");
        return s.ToString();
    }
    public static void EditAndSave(IntPtr window, uint pid, IntPtr edit, string expected, string text) {
        if (Edit(window, pid) != edit || ReadEdit(edit).Replace("\r\n","\n") != expected.Replace("\r\n","\n"))
            throw new Exception("Window or visible baseline no longer matches the issued working copy.");
        var fileMenu = GetSubMenu(GetMenu(window), 0);
        uint save = 0;
        for (int i = 0; i < GetMenuItemCount(fileMenu); i++) {
            var label = new StringBuilder(256);
            GetMenuString(fileMenu, (uint)i, label, label.Capacity, 0x0400);
            var parts = label.ToString().Split('\t');
            if (parts.Length == 2 && String.Equals(parts[1].Trim(), "Ctrl+S", StringComparison.OrdinalIgnoreCase)) {
                save = GetMenuItemID(fileMenu, i);
                break;
            }
        }
        if (save == 0 || save == UInt32.MaxValue) throw new Exception("Classic File > Save menu was not found.");
        IntPtr result;
        if (SendValue(edit, 0x00B1, IntPtr.Zero, (IntPtr)(-1), 3, 3000, out result) == IntPtr.Zero ||
            SendText(edit, 0x00C2, (IntPtr)1, text, 3, 3000, out result) == IntPtr.Zero ||
            ReadEdit(edit) != text || !Owned(window,pid) ||
            SendValue(window, 0x0111, (IntPtr)(long)save, IntPtr.Zero, 3, 8000, out result) == IntPtr.Zero)
            throw new Exception("Classic Notepad did not acknowledge the edit and Save command.");
    }
    public static bool CloseVerified(IntPtr window, uint pid) {
        return Owned(window,pid) && PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
    }
}
'@

$session = (Get-Process -Id $PID).SessionId
$deadline = [DateTime]::UtcNow.AddSeconds(30)
$match = $null
do {
    $matchesFound = @(Get-Process -Name notepad -ErrorAction SilentlyContinue | Where-Object {
        $_.SessionId -eq $session -and $_.MainWindowHandle -ne [IntPtr]::Zero -and
        ($_.MainWindowTitle.StartsWith($name + ' - ', [StringComparison]::OrdinalIgnoreCase) -or
         $_.MainWindowTitle.StartsWith($stem + ' - ', [StringComparison]::OrdinalIgnoreCase))
    })
    if ($matchesFound.Count -gt 1) { throw 'Multiple classic Notepad windows match the issued copy.' }
    if ($matchesFound.Count -eq 1) {
        $p = $matchesFound[0]
        $w = $p.MainWindowHandle
        $edit = [ClassicNotepadProbe]::Edit($w, $p.Id)
        if ($edit -ne [IntPtr]::Zero) { $match = $p; break }
    }
    Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
if (-not $match) {
    $windows = @(Get-Process -Name notepad -ErrorAction SilentlyContinue | Where-Object {
        $_.SessionId -eq $session -and $_.MainWindowHandle -ne [IntPtr]::Zero
    }).Count
    throw "No matching classic Notepad window in session $session ($windows visible Notepad windows)."
}
$nativeText = (CanonicalText $NewText).Replace("`n", "`r`n")
[ClassicNotepadProbe]::EditAndSave($w, $match.Id, $edit, $ExpectedText, $nativeText)

$deadline = [DateTime]::UtcNow.AddSeconds(10)
$saved = $false
do {
    try {
        $saved = [string]::Equals((CanonicalText ([IO.File]::ReadAllText($file))), (CanonicalText $NewText), [StringComparison]::Ordinal)
    } catch [IO.IOException] { }
    if ($saved) { break }
    Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
if (-not $saved) { throw 'Notepad Save did not publish the expected text on disk.' }
if (-not [ClassicNotepadProbe]::CloseVerified($w, $match.Id)) { throw 'Could not close the verified editor window.' }
$deadline = [DateTime]::UtcNow.AddSeconds(5)
while ([ClassicNotepadProbe]::Owned($w,$match.Id) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
if ([ClassicNotepadProbe]::Owned($w,$match.Id)) { throw 'The matched editor window did not close cleanly.' }
Write-Output 'PASS classic Notepad displayed the expected working copy, accepted File > Save, and published its edited text.'
