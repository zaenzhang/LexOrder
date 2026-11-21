[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$WorkingFile,
    [Parameter(Mandatory)][AllowEmptyString()][string]$ExpectedText,
    [Parameter(Mandatory)][string]$NewText
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$file = [IO.Path]::GetFullPath($WorkingFile)
$name = [IO.Path]::GetFileName($file)
if ($name -notmatch '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}_.+\.txt$' -or
    -not [IO.File]::Exists($file)) { throw 'Expected an app-issued synthetic TXT working copy.' }
function CanonicalText([string]$text) { $text.Replace("`r`n", "`n") }
$before = CanonicalText $ExpectedText
$after = CanonicalText $NewText
if ($before -ceq $after -or (CanonicalText ([IO.File]::ReadAllText($file))) -cne $before) {
    throw 'The fixture must match the expected baseline and the edit must change it.'
}

$scope = [System.Windows.Automation.TreeScope]::Descendants
$controlType = [System.Windows.Automation.AutomationElement]::ControlTypeProperty
$automationId = [System.Windows.Automation.AutomationElement]::AutomationIdProperty
$tabType = [System.Windows.Automation.PropertyCondition]::new($controlType, [System.Windows.Automation.ControlType]::TabItem)
$editorType = [System.Windows.Automation.PropertyCondition]::new($controlType, [System.Windows.Automation.ControlType]::Document)
$selectionPattern = [System.Windows.Automation.SelectionItemPattern]::Pattern
$invokePattern = [System.Windows.Automation.InvokePattern]::Pattern

function SelectedFixtureTab($root) {
    $root.FindAll($scope, $tabType) | Where-Object {
        $_.Current.Name.StartsWith($name + '. ', [StringComparison]::OrdinalIgnoreCase) -and
        $_.GetCurrentPattern($selectionPattern).Current.IsSelected
    }
}

$session = (Get-Process -Id $PID).SessionId
$deadline = [DateTime]::UtcNow.AddSeconds(25)
$root = $null
do {
    $windows = @(Get-Process Notepad -ErrorAction SilentlyContinue | Where-Object {
        $_.SessionId -eq $session -and $_.MainWindowHandle -ne [IntPtr]::Zero -and
        $_.MainWindowTitle.TrimStart('*').StartsWith($name + ' - ', [StringComparison]::OrdinalIgnoreCase)
    })
    if ($windows.Count -gt 1) { throw 'Multiple Notepad windows match the synthetic file.' }
    if ($windows.Count -eq 1) {
        $candidate = [System.Windows.Automation.AutomationElement]::FromHandle($windows[0].MainWindowHandle)
        if (@(SelectedFixtureTab $candidate).Count -eq 1) { $root = $candidate; break }
    }
    Start-Sleep -Milliseconds 150
} while ([DateTime]::UtcNow -lt $deadline)
if (!$root) {
    $choice = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.txt\UserChoice' -Name ProgId -ErrorAction SilentlyContinue
    $registered = Get-Item -LiteralPath 'Registry::HKEY_CLASSES_ROOT\.txt' -ErrorAction SilentlyContinue
    $extensionHandler = if ($registered) { $registered.GetValue('') }
    $notepad = @(Get-Process Notepad -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $session })
    $stem = [IO.Path]::GetFileNameWithoutExtension($name)
    Write-Output "TXT association user=$($choice.ProgId) registered=$extensionHandler; Notepad processes=$($notepad.Count) in session $session"
    foreach ($process in $notepad) {
        $handle = $process.MainWindowHandle
        $title = $process.MainWindowTitle
        $carriesFixture = $title.IndexOf($stem, [StringComparison]::OrdinalIgnoreCase) -ge 0
        $carriesExtension = $title.IndexOf($name, [StringComparison]::OrdinalIgnoreCase) -ge 0
        $tabs = $documents = $editControls = 0
        if ($handle -ne [IntPtr]::Zero) {
            $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
            $editType = [System.Windows.Automation.PropertyCondition]::new($controlType, [System.Windows.Automation.ControlType]::Edit)
            $tabs = $window.FindAll($scope, $tabType).Count
            $documents = $window.FindAll($scope, $editorType).Count
            $editControls = $window.FindAll($scope, $editType).Count
        }
        Write-Output "Notepad window=$($handle -ne [IntPtr]::Zero) fixtureName=$carriesFixture fixtureExtension=$carriesExtension tabs=$tabs documents=$documents edits=$editControls"
    }
    throw 'The synthetic file is not selected in Windows Notepad.'
}

$editors = @($root.FindAll($scope, $editorType) | Where-Object { !$_.Current.IsOffscreen })
if ($editors.Count -ne 1) { throw 'The selected Notepad tab has no unique visible editor.' }
$value = $editors[0].GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
if ((CanonicalText $value.Current.Value) -cne $before) { throw 'The visible editor text does not match the working copy.' }
$value.SetValue($NewText)
if ((CanonicalText $value.Current.Value) -cne $after -or @(SelectedFixtureTab $root).Count -ne 1) {
    throw 'The selected test tab did not accept the edit.'
}

$fileMenu = $root.FindFirst($scope, [System.Windows.Automation.PropertyCondition]::new($automationId, 'File'))
$fileMenu.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
$accelerator = [System.Windows.Automation.AutomationElement]::AcceleratorKeyProperty
$saveCondition = [System.Windows.Automation.PropertyCondition]::new($accelerator, 'Ctrl+S')
$deadline = [DateTime]::UtcNow.AddSeconds(5)
do {
    $save = $root.FindFirst($scope, $saveCondition)
    if ($save) { break }
    Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
if (!$save -or @(SelectedFixtureTab $root).Count -ne 1) { throw 'No Save command for the selected test tab.' }
$save.GetCurrentPattern($invokePattern).Invoke()

$deadline = [DateTime]::UtcNow.AddSeconds(10)
do {
    try {
        if ((CanonicalText ([IO.File]::ReadAllText($file))) -ceq $after) { break }
    } catch [IO.IOException] { }
    Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
if ((CanonicalText ([IO.File]::ReadAllText($file))) -cne $after) { throw 'Notepad did not save the expected text.' }

$tabs = @(SelectedFixtureTab $root)
if ($tabs.Count -ne 1) { throw 'The saved fixture tab is no longer selected.' }
$close = $tabs[0].FindFirst($scope, [System.Windows.Automation.PropertyCondition]::new($automationId, 'CloseButton'))
$close.GetCurrentPattern($invokePattern).Invoke()
Write-Output 'PASS Windows Notepad saved the verified synthetic working copy and closed its tab.'
