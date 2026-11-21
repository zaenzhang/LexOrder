on getText(uiNode, propertyName)
	try
		tell application "System Events" to return value of attribute propertyName of uiNode
	on error
		return missing value
	end try
end getText

on run argv
	set desktopPID to (item 1 of argv) as integer
	set operation to item 2 of argv
	set targetLabel to item 3 of argv
	tell application "System Events"
		set desktopProcesses to application processes whose unix id is desktopPID
		if (count of desktopProcesses) is 0 then return "no application process"
		set desktopProcess to item 1 of desktopProcesses
		if (count of windows of desktopProcess) is 0 then return "no application window"
		set desktopWindow to window 1 of desktopProcess
		if operation is "close" then
			perform action "AXPress" of (first button of desktopWindow whose subrole is "AXCloseButton")
			return "pressed"
		end if
		if operation is in {"open-panel", "go-to-folder", "select-files"} then
			repeat with candidate in windows of desktopProcess
				if my getText(candidate, "AXModal") is true or my getText(candidate, "AXTitle") is "Open" then
					if operation is "open-panel" then return "open"
					if operation is "go-to-folder" then
						set frontmost of desktopProcess to true
						keystroke "3" using command down
						keystroke "g" using {command down, shift down}
						delay 0.5
						keystroke targetLabel
						delay 0.5
						key code 36
						return "navigated"
					end if
					set frontmost of desktopProcess to true
					-- Go to Folder selects the folder row in column view. Enter its file column.
					key code 124
					delay 0.3
					keystroke "a" using command down
					set confirmButton to first button of candidate whose name is "Open"
					if not (enabled of confirmButton) then return "no files were selected in the Open panel"
					perform action "AXPress" of confirmButton
					return "submitted"
				end if
			end repeat
			return "no native Open panel"
		end if
		if operation is "bounds" then
			set {leftEdge, topEdge} to position of desktopWindow
			set {windowWidth, windowHeight} to size of desktopWindow
			return (leftEdge as text) & "," & (topEdge as text) & "," & (windowWidth as text) & "," & (windowHeight as text)
		end if
		set samples to {}
		set consecutiveText to ""
		set selectedFiles to {}
		set tree to entire contents of desktopWindow
		repeat with uiNode in tree
			set nodeRole to my getText(uiNode, "AXRole")
			set isControl to nodeRole is in {"AXButton", "AXPopUpButton", "AXMenuButton", "AXMenuItem", "AXLink", "AXFileUploadButton"}
			if operation is "page" and nodeRole is "AXStaticText" then
				set pageText to my getText(uiNode, "AXValue")
				if pageText is not missing value and pageText ends with " · 本机承办工作" then
					set {windowWidth, windowHeight} to size of desktopWindow
					return (windowWidth as text) & " " & (windowHeight as text)
				end if
			end if
			if operation is "text" then
				if nodeRole is "AXStaticText" then
					set pageText to my getText(uiNode, "AXValue")
					if pageText is not missing value then
						set consecutiveText to consecutiveText & pageText
						if consecutiveText ends with targetLabel then return "1"
					end if
				else
					set consecutiveText to ""
				end if
			end if
			if operation is "queued-files" and nodeRole is "AXButton" then
				set buttonLabel to my getText(uiNode, "AXTitle")
				if buttonLabel is not missing value and buttonLabel starts with "移除 " then set end of selectedFiles to text 4 thru -1 of buttonLabel
			end if
			if operation is "press" and isControl then
				if my getText(uiNode, "AXTitle") is targetLabel or my getText(uiNode, "AXDescription") is targetLabel then
					perform action "AXPress" of uiNode
					return "pressed"
				end if
			end if
			if operation is "heading" and nodeRole is "AXHeading" then
				if my getText(uiNode, "AXTitle") is targetLabel or my getText(uiNode, "AXValue") is targetLabel then return "found"
				repeat with descendant in (entire contents of uiNode)
					if my getText(descendant, "AXValue") is targetLabel then return "found"
				end repeat
			end if
			if operation is "inspect" and (isControl or nodeRole is in {"AXStaticText", "AXHeading", "AXWebArea", "AXTextField", "AXComboBox", "AXRow"}) and (count of samples) is less than 120 then
				set end of samples to {nodeRole, my getText(uiNode, "AXValue"), my getText(uiNode, "AXTitle"), my getText(uiNode, "AXDescription")}
			end if
		end repeat
		if operation is "inspect" then return {size of desktopWindow, count of tree, samples}
		if operation is "queued-files" then return selectedFiles
	end tell
	return "control or content unavailable"
end run
