on run argv
	set desktopPID to (item 1 of argv) as integer
	tell application "System Events"
		set desktopProcesses to application processes whose unix id is desktopPID
		if (count of desktopProcesses) is 0 then return ""
		set desktopProcess to item 1 of desktopProcesses
		if (count of windows of desktopProcess) is 0 then return ""
		set desktopWindow to window 1 of desktopProcess
		if item 2 of argv is "close" then
			perform action "AXPress" of (first button of desktopWindow whose subrole is "AXCloseButton")
			return "pressed"
		end if
		repeat with uiNode in (entire contents of desktopWindow)
			set pageText to missing value
			try
				if role of uiNode is "AXStaticText" then set pageText to value of uiNode
			end try
			if pageText is not missing value and pageText ends with " · 本机承办工作" then
				set {windowWidth, windowHeight} to size of desktopWindow
				return (windowWidth as text) & " " & (windowHeight as text)
			end if
		end repeat
	end tell
	return ""
end run
