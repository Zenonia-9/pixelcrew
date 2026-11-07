param([string]$StatePath, [int]$OwnerPid)
Add-Type -AssemblyName PresentationFramework
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OverlayNative {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h,int n,int v);
 public struct Rect { public int Left,Top,Right,Bottom; }
 public struct Point { public int X,Y; }
}
'@
$view = New-Object Windows.Window
$view.WindowStyle='None'; $view.AllowsTransparency=$true; $view.Background='Transparent'
$view.Topmost=$true; $view.ShowInTaskbar=$false; $view.ShowActivated=$false
$canvas=New-Object Windows.Controls.Canvas
$view.Content=$canvas
$shade=New-Object Windows.Controls.Border
$shade.Background='#16000000'; $shade.BorderBrush='#BBE8BC72'; $shade.BorderThickness='3'
$canvas.Children.Add($shade) | Out-Null
$label=New-Object Windows.Controls.TextBlock
$label.Text='PixelCrew is controlling this window'; $label.Foreground='White'; $label.Background='#DD25251F'; $label.Padding='12,6'
[Windows.Controls.Canvas]::SetTop($label,8); [Windows.Controls.Canvas]::SetLeft($label,8)
$canvas.Children.Add($label) | Out-Null
$arrow=New-Object Windows.Shapes.Path
$arrow.Data=[Windows.Media.Geometry]::Parse('M 4,3 Q 2,2 3,5 L 7,20 Q 8,22 9,19 L 12,13 L 18,10 Q 21,9 18,8 Z')
$arrow.Fill='#FF25251F'; $arrow.Stroke='#FFFFF1CF'; $arrow.StrokeThickness=1.8
$glow=New-Object Windows.Media.Effects.DropShadowEffect
$glow.Color=[Windows.Media.ColorConverter]::ConvertFromString('#FFE8BC72')
$glow.BlurRadius=14; $glow.ShadowDepth=0; $glow.Opacity=1
$arrow.Effect=$glow
$canvas.Children.Add($arrow) | Out-Null
$view.Add_SourceInitialized({
 $handle=(New-Object Windows.Interop.WindowInteropHelper($view)).Handle
 $style=[OverlayNative]::GetWindowLong($handle,-20)
 [OverlayNative]::SetWindowLong($handle,-20,($style -bor 0x80000 -bor 0x20 -bor 0x08000000 -bor 0x80)) | Out-Null
 [IO.File]::WriteAllText($StatePath+'.ready','ready')
})
$timer=New-Object Windows.Threading.DispatcherTimer
$timer.Interval=[TimeSpan]::FromMilliseconds(33)
$script:target=[IntPtr]::Zero
$script:lastExpiry=0
$script:pointerX=0.0
$script:pointerY=0.0
$timer.Add_Tick({
 if (-not (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)) { $view.Close(); return }
 try { $state=Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json } catch { return }
 if (-not $state.active -or [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -gt $state.expires) { $view.Hide(); return }
 if ($state.expires -ne $script:lastExpiry) {
   $script:target=[OverlayNative]::GetForegroundWindow()
   $script:lastExpiry=$state.expires
 }
 if ([OverlayNative]::GetForegroundWindow() -ne $script:target) { $view.Hide(); return }
 $rect=New-Object OverlayNative+Rect
 if (-not [OverlayNative]::GetWindowRect($script:target,[ref]$rect)) { $view.Hide(); return }
 $source=[Windows.PresentationSource]::FromVisual($view)
 $scale=1.0
 if ($source) { $scale=$source.CompositionTarget.TransformFromDevice.M11 }
 $view.Left=$rect.Left*$scale; $view.Top=$rect.Top*$scale
 $view.Width=[Math]::Max(1,($rect.Right-$rect.Left)*$scale); $view.Height=[Math]::Max(1,($rect.Bottom-$rect.Top)*$scale)
 $shade.Width=$view.Width; $shade.Height=$view.Height
 $arrow.Visibility='Visible'
 $cursor=New-Object OverlayNative+Point
 [OverlayNative]::GetCursorPos([ref]$cursor) | Out-Null
 $targetX=if ($null -ne $state.x) {[double]$state.x*$scale} else {($cursor.X-$rect.Left)*$scale}
 $targetY=if ($null -ne $state.y) {[double]$state.y*$scale} else {($cursor.Y-$rect.Top)*$scale}
 $targetX=[Math]::Max(4,[Math]::Min($view.Width-24,$targetX))
 $targetY=[Math]::Max(4,[Math]::Min($view.Height-30,$targetY))
 $script:pointerX+=($targetX-$script:pointerX)*0.4
 $script:pointerY+=($targetY-$script:pointerY)*0.4
 [Windows.Controls.Canvas]::SetLeft($arrow,$script:pointerX)
 [Windows.Controls.Canvas]::SetTop($arrow,$script:pointerY)
 $view.Show()
})
$timer.Start()
$app=New-Object Windows.Application
$app.Run($view) | Out-Null
