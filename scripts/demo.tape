# vhs 演示脚本 — scripts/record-demo.sh 负责起停配套 dev server
Output docs/demo.gif

Set FontSize 16
Set Width 1080
Set Height 600
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Type "# Which port belongs to which project, started by which agent?"
Enter
Type "portmarshal list --project $DEMO_PROJECT"
Enter
Sleep 2.5s

Type "portmarshal whois 18923"
Enter
Sleep 3s

Type "# Try to stop another agent's live service — the guard steps in"
Enter
Type "portmarshal stop 18923"
Enter
Sleep 3.5s

Type "portmarshal stop 18923 --force"
Enter
Sleep 2.5s

Type "# Reserve a port for your own dev server (idempotent + sticky)"
Enter
Type "PORT=$(portmarshal claim web --prefer 3000); echo $PORT"
Enter
Sleep 2.5s
