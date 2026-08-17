param([string]$pptPath)

$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open($pptPath, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse)
$count = $pres.Slides.Count
for ($i = [Math]::Max(1, $count - 1); $i -le $count; $i++) {
  $slide = $pres.Slides.Item($i)
  for ($s = $slide.Shapes.Count; $s -ge 1; $s--) {
    $shape = $slide.Shapes.Item($s)
    if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
      $text = $shape.TextFrame.TextRange.Text
      if ($text -eq '金融总部科技版' -or $text -eq '算法研发备选版') {
        $shape.Delete()
      }
    }
  }
}
$pres.Save()
$pres.Close()
$app.Quit()
