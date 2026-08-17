param([string]$pptPath)

function Walk-Shapes($shapes, $prefix) {
  foreach ($shape in $shapes) {
    $txt = ''
    if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
      $txt = $shape.TextFrame.TextRange.Text
    }
    [pscustomobject]@{
      Path = "$prefix/$($shape.Id)"
      Name = $shape.Name
      Type = $shape.Type
      Left = [math]::Round($shape.Left, 1)
      Top = [math]::Round($shape.Top, 1)
      Width = [math]::Round($shape.Width, 1)
      Height = [math]::Round($shape.Height, 1)
      Text = $txt
    }

    if ($shape.Type -eq 6) {
      Walk-Shapes $shape.GroupItems "$prefix/$($shape.Id)"
    }

    if ($shape.Type -eq 19) {
      for ($r = 1; $r -le $shape.Table.Rows.Count; $r++) {
        for ($c = 1; $c -le $shape.Table.Columns.Count; $c++) {
          $cell = $shape.Table.Cell($r, $c).Shape
          $ct = ''
          if ($cell.TextFrame.HasText -eq -1) {
            $ct = $cell.TextFrame.TextRange.Text
          }
          if ($ct) {
            [pscustomobject]@{
              Path = "$prefix/$($shape.Id)/cell$r-$c"
              Name = 'CELL'
              Type = 'cell'
              Left = ''
              Top = ''
              Width = ''
              Height = ''
              Text = $ct
            }
          }
        }
      }
    }
  }
}

$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open($pptPath, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse)
Walk-Shapes $pres.Slides.Item(11).Shapes 's11' | Format-List
$pres.Close()
$app.Quit()
