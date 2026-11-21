using System;
using System.Runtime.InteropServices;
using System.Text;

// Test-only controls for the classic Notepad shipped in the Windows Server runner.
public static class ClassicNotepad
{
    private const uint GetText = 0x000D;
    private const uint SetText = 0x000C;
    private const uint SetModified = 0x00B9;
    private const uint Command = 0x0111;
    private const uint CloseWindow = 0x0010;
    private const uint AbortIfHung = 0x0002;
    private const uint ByPosition = 0x0400;
    private const uint TimeoutMs = 3000;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
    [DllImport("user32.dll")]
    private static extern IntPtr GetMenu(IntPtr window);
    [DllImport("user32.dll")]
    private static extern IntPtr GetSubMenu(IntPtr menu, int position);
    [DllImport("user32.dll")]
    private static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll")]
    private static extern uint GetMenuItemID(IntPtr menu, int position);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetMenuString(IntPtr menu, uint item, StringBuilder text, int maximum, uint flags);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", ExactSpelling = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr SendText(IntPtr window, uint message, UIntPtr param, string text, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", ExactSpelling = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr ReadText(IntPtr window, uint message, UIntPtr param, StringBuilder text, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", ExactSpelling = true)]
    private static extern IntPtr SendCommand(IntPtr window, uint message, UIntPtr param, IntPtr extra, uint flags, uint timeout, out UIntPtr result);

    public static IntPtr FindEditor(IntPtr window, IntPtr after)
    {
        return FindWindowEx(window, after, "Edit", null);
    }

    private static string GetEditorText(IntPtr editor, int capacity)
    {
        var text = new StringBuilder(capacity);
        UIntPtr result;
        if (ReadText(editor, GetText, (UIntPtr)capacity, text, AbortIfHung, TimeoutMs, out result) == IntPtr.Zero)
            throw new InvalidOperationException("Classic Notepad did not return the editor text.");
        return text.ToString().Replace("\r\n", "\n");
    }

    public static void SaveFixture(IntPtr window, IntPtr editor, string before, string after)
    {
        var capacity = Math.Max(before.Length, after.Length) + 32;
        if (GetEditorText(editor, capacity) != before)
            throw new InvalidOperationException("Classic Notepad text does not match the fixture.");

        var menu = GetSubMenu(GetMenu(window), 0);
        uint save = 0;
        var label = new StringBuilder(128);
        var count = GetMenuItemCount(menu);
        for (var i = 0; i < count; i++)
        {
            label.Clear();
            GetMenuString(menu, (uint)i, label, label.Capacity, ByPosition);
            if (label.ToString().EndsWith("\tCtrl+S", StringComparison.OrdinalIgnoreCase))
                save = GetMenuItemID(menu, i);
        }
        if (save == 0 || save == UInt32.MaxValue)
            throw new InvalidOperationException("Classic Notepad did not expose its Save command.");

        UIntPtr result;
        if (SendText(editor, SetText, UIntPtr.Zero, after.Replace("\n", "\r\n"), AbortIfHung, TimeoutMs, out result) == IntPtr.Zero ||
            result == UIntPtr.Zero || GetEditorText(editor, capacity) != after)
            throw new InvalidOperationException("Classic Notepad did not accept the synthetic edit.");

        Invoke(editor, SetModified, 1);
        Invoke(window, Command, save);
    }

    public static void CloseFixture(IntPtr window)
    {
        Invoke(window, CloseWindow, 0);
    }

    private static void Invoke(IntPtr window, uint message, uint parameter)
    {
        UIntPtr result;
        if (SendCommand(window, message, (UIntPtr)parameter, IntPtr.Zero, AbortIfHung, TimeoutMs, out result) == IntPtr.Zero)
            throw new InvalidOperationException("Classic Notepad did not process the fixture command.");
    }
}
