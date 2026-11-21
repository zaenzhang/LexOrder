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
		if operation is "bounds" then
			set {leftEdge, topEdge} to position of desktopWindow
			set {windowWidth, windowHeight} to size of desktopWindow
			return (leftEdge as text) & "," & (topEdge as text) & "," & (windowWidth as text) & "," & (windowHeight as text)
		end if
		set samples to {}
		set tree to entire contents of desktopWindow
		repeat with uiNode in tree
			set nodeRole to my getText(uiNode, "AXRole")
			set isControl to nodeRole is in {"AXButton", "AXPopUpButton", "AXMenuButton", "AXMenuItem", "AXLink"}
			if operation is "page" and nodeRole is "AXStaticText" then
				set pageText to my getText(uiNode, "AXValue")
				if pageText is not missing value and pageText ends with " · 本机承办工作" then
					set {windowWidth, windowHeight} to size of desktopWindow
					return (windowWidth as text) & " " & (windowHeight as text)
				end if
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
			if operation is "inspect" and (isControl or nodeRole is in {"AXStaticText", "AXHeading", "AXWebArea"}) and (count of samples) is less than 120 then
				set end of samples to {nodeRole, my getText(uiNode, "AXValue"), my getText(uiNode, "AXTitle"), my getText(uiNode, "AXDescription")}
			end if
		end repeat
		if operation is "inspect" then return {size of desktopWindow, count of tree, samples}
	end tell
	return "control or content unavailable"
end run
