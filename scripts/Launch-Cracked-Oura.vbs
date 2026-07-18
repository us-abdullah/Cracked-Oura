Set WshShell = CreateObject("WScript.Shell")
exe = "C:\Users\usman\.cursor\Cracked-Oura\frontend\dist\win-unpacked\Usman Biotracker.exe"
WshShell.CurrentDirectory = "C:\Users\usman\.cursor\Cracked-Oura\frontend\dist\win-unpacked"
WshShell.Run """" & exe & """", 1, False
