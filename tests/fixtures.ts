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
 * 2755 为孤儿(ppid=1)；8660 父链 zsh(700)→Cursor(600)；31401 父链 →Cursor(600) */
export const PS_TABLE = `    1     0 /sbin/launchd
 2755     1 /opt/homebrew/Cellar/python@3.14/3.14.5/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python
  600     1 /Applications/Cursor.app/Contents/MacOS/Cursor
  700   600 /bin/zsh
 8660   700 /Users/worsher/.n/bin/node
31401   600 /Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin)
`;
