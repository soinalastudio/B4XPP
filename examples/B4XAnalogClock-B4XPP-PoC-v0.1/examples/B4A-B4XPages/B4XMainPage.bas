Sub Class_Globals
    Private Root As B4XView
    Private xui As XUI
    Private Clock As B4XAnalogClock
End Sub

Public Sub Initialize
End Sub

Private Sub B4XPage_Created (Root1 As B4XView)
    Root = Root1
    Root.Color = xui.Color_RGB(245, 247, 250)

    Dim side As Int = Min(Root.Width, Root.Height) - 40dip
    Clock.Initialize(Me, "Clock")
    Clock.AddToParent(Root, 20dip, 40dip, side, side)
    Clock.Start
End Sub

Private Sub Clock_Click(Tag As Object)
    Log("Clock clicked")
End Sub
