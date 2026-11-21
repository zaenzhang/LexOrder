on run argv
	set desktopPID to (item 1 of argv) as integer
	set inspection to item 2 of argv is "inspect"
	tell application "System Events"
		set desktopProcesses to application processes whose unix id is desktopPID
		if (count of desktopProcesses) is 0 then return "no application process"
		set desktopProcess to item 1 of desktopProcesses
		if (count of windows of desktopProcess) is 0 then return "no application window"
		set desktopWindow to window 1 of desktopProcess
		if item 2 of argv is "close" then
			perform action "AXPress" of (first button of desktopWindow whose subrole is "AXCloseButton")
			return "pressed"
		end if
		set samples to {}
		set tree to entire contents of desktopWindow
		repeat with uiNode in tree
			try
				set nodeRole to role of uiNode
				if nodeRole is "AXStaticText" or nodeRole is "AXHeading" or nodeRole is "AXWebArea" then
					set pageText to missing value
					try
						set pageText to value of attribute "AXValue" of uiNode
					end try
					if nodeRole is "AXStaticText" and pageText is not missing value and pageText ends with " · 本机承办工作" then
						set {windowWidth, windowHeight} to size of desktopWindow
						return (windowWidth as text) & " " & (windowHeight as text)
					end if
					if inspection and (count of samples) is less than 90 then
						set sample to {nodeRole, pageText}
						repeat with propertyName in {"AXTitle", "AXDescription"}
							try
								set end of sample to value of attribute (contents of propertyName) of uiNode
							on error
								set end of sample to missing value
							end try
						end repeat
						set end of samples to sample
					end if
				end if
			end try
		end repeat
		if inspection then return {size of desktopWindow, count of tree, samples}
	end tell
	return "window open, data text missing"
end run
