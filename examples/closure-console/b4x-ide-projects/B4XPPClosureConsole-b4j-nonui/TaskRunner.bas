B4J=true
Group=Default Group
ModulesStructureVersion=1
Type=Class
Version=10.0
@EndOfDesignText@

Sub Class_Globals
    Private mNames As List
    Private mActions As List
End Sub



' B4X++ constructor: generated as Initialize
Public Sub Initialize
    mNames.Initialize
    mActions.Initialize
End Sub

Public Sub Add(Name As String, Action As B4XPPClosure)
    mNames.Add(Name)
    mActions.Add(Action)
End Sub

Public Sub RunAll(Value As Int)
    For i = 0 To mActions.Size - 1
        Dim action As B4XPPClosure = mActions.Get(i)
        Log(mNames.Get(i) & "(" & Value & ") = " & action.Run1(Value))
    Next
End Sub
