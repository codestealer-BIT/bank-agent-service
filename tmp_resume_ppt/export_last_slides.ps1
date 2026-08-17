param([string]$pptPath, [string]$outDir)

$resolvedOut = (New-Item -ItemType Directory -Force -Path $outDir).FullName
$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open($pptPath, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse)
$count = $pres.Slides.Count
for ($i = [Math]::Max(1, $count - 1); $i -le $count; $i++) {
  $path = Join-Path $resolvedOut ("slide-$i.png")
  $pres.Slides.Item($i).Export($path, "PNG", 760, 1049)
}
[pscustomobject]@{ SlideCount = $count; Exported = $resolvedOut } | Format-List
$pres.Close()
$app.Quit()
