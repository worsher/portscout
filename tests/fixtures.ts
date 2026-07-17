/** lsof -iTCP -sTCP:LISTEN -P -n -Fpcn 的机器格式样本 */
export const LSOF_FPCN = `p2755
cPython
n*:8901
p8660
cnode
n127.0.0.1:8000
n[::1]:8000
p31401
cCursor Helper (Plugin)
n127.0.0.1:63979
`;

/** ps -axo pid=,ppid=,comm= 样本：
 * 2755 为孤儿(ppid=1)；8660 父链 zsh(700)→Cursor(600)；31401 父链 →Cursor(600)；
 * 8123 父链 zsh(810)→Claude(800)；9123 父链 →Antigravity(900)；
 * 10123 父链 zsh(1010)→Terminal.app(1000)；11123 父链 →Docker(1100) */
export const PS_TABLE = `    1     0 /sbin/launchd
 2755     1 /opt/homebrew/Cellar/python@3.14/3.14.5/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python
  600     1 /Applications/Cursor.app/Contents/MacOS/Cursor
  700   600 /bin/zsh
 8660   700 /Users/worsher/.n/bin/node
31401   600 /Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin)
  800     1 /Applications/Claude.app/Contents/MacOS/claude
  810   800 /bin/zsh
 8123   810 /usr/local/bin/node
  900     1 /Applications/Antigravity.app/Contents/MacOS/Antigravity
 9123   900 /usr/local/bin/node
 1000     1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal
 1010  1000 /bin/zsh
10123  1010 /usr/local/bin/python3
 1100     1 /Applications/Docker.app/Contents/MacOS/com.docker.backend
11123  1100 docker-proxy
12000     1 /Users/worsher/.openclaw/bin/openclaw-gateway
14000 12000 /usr/local/bin/node
13000     1 /Applications/Postman.app/Contents/MacOS/Postman
`;

/** launchctl list 样本：PID\tStatus\tLabel，"-" 表示未运行 */
export const LAUNCHCTL_LIST = `PID	Status	Label
-	0	com.apple.SafariHistoryServiceAgent
1513	0	com.apple.Finder
12000	0	com.openclaw.gateway
`;
