# A0 (Goal 20) — DOES THE QA WINDOW CAPTURE THE OPERATOR'S CURSOR?
#
# The owner's complaint is an OS-level fact, not a game-level one: while a QA
# driver runs, the physical mouse pointer vanishes and cannot leave the Electron
# window. So the instrument has to ask WINDOWS, not the page.
#
# Two independent Win32 facts are sampled, because either one alone can lie:
#   * GetCursorInfo().flags  — bit 0 (CURSOR_SHOWING) clear means the pointer is
#     HIDDEN. Chromium hides it while pointer lock is held.
#   * GetClipCursor(rect)    — the OS confinement rectangle. Free, it equals the
#     whole virtual desktop. Pointer-locked, Chromium clips it to (about) the
#     window, which is literally "locked inside the Electron window".
# GetCursorPos is recorded too so a pinned/recentred pointer is visible.
#
# NEGATIVE CONTROL: run this with no Electron up and wiggle nothing. It must
# report showing=1 and clip == the full virtual screen on every sample. An
# instrument that cannot report "free" cannot be trusted when it reports
# "captured".
#
#   powershell -NoProfile -File tools/qa/cursor-capture-watch.ps1 -Seconds 90 -Out qa/electron/a-mousetrap/watch.jsonl
param(
  [int]$Seconds = 60,
  [string]$Out = "qa/electron/a-mousetrap/watch.jsonl",
  [int]$Hz = 20
)

Add-Type -Namespace FwQa -Name Cur -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct POINT { public int X; public int Y; }
[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[StructLayout(LayoutKind.Sequential)]
public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT ptScreenPos; }
[DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO pci);
[DllImport("user32.dll")] public static extern bool GetClipCursor(out RECT lpRect);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@

# CAUGHT BY THIS SCRIPT'S OWN NEGATIVE CONTROL, and it would have been a false
# "captured" on every sample. PowerShell starts DPI-unaware, so Windows hands the
# two APIs coordinates in two different spaces: GetSystemMetrics reported a
# 5120 px virtual screen while GetClipCursor reported a 4267 px free rectangle
# (5120 / 1.25, the display's scale factor). Comparing them said "the cursor is
# confined" while it was sitting free on the desktop. Declaring DPI awareness
# puts both in physical pixels, which is the only space in which the comparison
# means anything.
[void][FwQa.Cur]::SetProcessDPIAware()

# SM_XVIRTUALSCREEN 76, SM_YVIRTUALSCREEN 77, SM_CXVIRTUALSCREEN 78, SM_CYVIRTUALSCREEN 79
$vx = [FwQa.Cur]::GetSystemMetrics(76)
$vy = [FwQa.Cur]::GetSystemMetrics(77)
$vw = [FwQa.Cur]::GetSystemMetrics(78)
$vh = [FwQa.Cur]::GetSystemMetrics(79)
# SM_CXSCREEN / SM_CYSCREEN — the primary monitor, the yardstick for "free"
$pw = [FwQa.Cur]::GetSystemMetrics(0)
$ph = [FwQa.Cur]::GetSystemMetrics(1)

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$sw = New-Object System.IO.StreamWriter($Out, $false, [System.Text.Encoding]::UTF8)
$sw.WriteLine((ConvertTo-Json -Compress @{
  kind = "header"; virtualScreen = @{ x = $vx; y = $vy; w = $vw; h = $vh }
  seconds = $Seconds; hz = $Hz
}))

$deadline = (Get-Date).AddSeconds($Seconds)
$delay = [int](1000 / [Math]::Max(1, $Hz))
$n = 0
while ((Get-Date) -lt $deadline) {
  $ci = New-Object FwQa.Cur+CURSORINFO
  $ci.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($ci)
  $okInfo = [FwQa.Cur]::GetCursorInfo([ref]$ci)
  $rect = New-Object FwQa.Cur+RECT
  $okClip = [FwQa.Cur]::GetClipCursor([ref]$rect)
  # "free" means the confinement rectangle is still the entire virtual desktop
  # "Free" is judged against the PRIMARY MONITOR, not the virtual-screen metric.
  # On this desktop the two disagree even when DPI-aware (virtual 7680 wide, free
  # clip 6400), because the monitors run at different scale factors and the two
  # APIs do not resolve that the same way. The distinction that actually matters
  # needs no such precision: a captured cursor is confined to a WINDOW, which was
  # measured at 1601 x 900, while a free one gets the whole desktop. Requiring
  # the clip to cover at least one monitor separates those by a factor of eight
  # and cannot be thrown off by a scale factor.
  $clipW = $rect.Right - $rect.Left
  $clipH = $rect.Bottom - $rect.Top
  $clipFree = ($clipW * [double]$clipH) -ge (0.95 * $pw * $ph)
  $sw.WriteLine((ConvertTo-Json -Compress @{
    t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    showing = [int]($ci.flags -band 1)
    x = $ci.ptScreenPos.X; y = $ci.ptScreenPos.Y
    clip = @($rect.Left, $rect.Top, $rect.Right, $rect.Bottom)
    clipFree = [int]$clipFree
    okInfo = [int]$okInfo; okClip = [int]$okClip
  }))
  $n++
  Start-Sleep -Milliseconds $delay
}
$sw.Close()
Write-Output "WATCH DONE samples=$n out=$Out"
