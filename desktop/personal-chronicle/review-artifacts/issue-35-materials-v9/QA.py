from pathlib import Path
from tempfile import TemporaryDirectory
from bs4 import BeautifulSoup
import re, subprocess, sys
p=Path(__file__).resolve().parent / 'LexOrder-Materials-Workflow-v9.html'
s=p.read_text()
checks=[]
def check(name, ok, detail=''):
    checks.append((name,bool(ok),detail))
# Parse document structure and embedded JavaScript syntax.
soup=BeautifulSoup(s,'html.parser')
check('HTML document parses', soup.html is not None and soup.body is not None)
script=soup.find('script')
check('One application script present', script is not None)
if script:
    with TemporaryDirectory(prefix='lexorder-materials-qa-') as temp:
        tmp = Path(temp) / 'app.js'
        tmp.write_text(script.string or script.get_text(), encoding='utf-8')
        proc = subprocess.run(['node','--check',str(tmp)], capture_output=True, text=True)
    check('Embedded JavaScript syntax', proc.returncode == 0, (proc.stderr or proc.stdout).strip())
else:
    check('Embedded JavaScript syntax',False,'script missing')
# Domain vocabulary and distinctions.
check('Six DocumentCategory options visible', all(x in s for x in ['EVIDENCE','PLEADING','PROCEDURE','JUDGMENT','CONTRACT','OTHER']))
check('Five source-origin options visible', all(x in s for x in ['CLIENT_PROVIDED','COURT_SERVED','AI_EXTRACTED','SELF_COLLECTED','TEAM_PRODUCED']))
check('Court served is no longer labeled verified', '法院送达（已核实入卷）' not in s)
check('Court inbox remains a separate workflow', '事务 → 法院来件' in s)
check('Work-draft view is derived, not category enum', 'isDesktopEditableDraft' in s and '当前可编辑工作稿' in s)
check('No category named 工作稿 added', 'categoryLabels={EVIDENCE' in s and 'WORK_DRAFT' not in s)
# Interaction rules.
check('Material intake uses centered Dialog', 'workflow-dialog' in s and 'role="dialog" aria-modal="true"' in s)
check('Case directory is the persistent Sheet exception', "l.type==='folder'" in s and 'class="sheet"' in s)
check('File detail uses Dialog, not Sheet', "l.type==='detail'" in s and 'dialog-large' in s)
check('Per-file submit/retry actions retained', 'data-act="importThis"' in s and 'data-act="continueImport"' in s and 'data-act="inspectImport"' in s)
check('Shared defaults apply only to editable items', 'applyImportDefaults' in s and 'importEditable' in s)
check('Unknown result / idempotent retry states retained', all(x in s for x in ['UNKNOWN','INCOMPLETE','key:`${state.caseId}-REQ','hasIntent']))
check('Court inbox wording avoids false verification claim', '这个字段本身不代表来件流程已完成' in s)
# Typography / microcopy refinement.
check('Body typography raised to 14px', 'body{font-size:14px;line-height:1.52}' in s)
check('Debug source affordance hidden from main workspace', '.sources-btn{display:none!important;' in s)
check('Verbose workflow microcopy replaced', '先选文件，再逐件核对，确认后提交。' in s)
# Produce a compact report.
lines=['# LexOrder Materials v9 — Static QA','',f'File: {p.name}',f'Bytes: {p.stat().st_size}','', '| Check | Result | Detail |','|---|---|---|']
for name,ok,detail in checks:
    lines.append(f"| {name} | {'PASS' if ok else 'FAIL'} | {detail.replace('|','/')} |")
passed=sum(ok for _,ok,_ in checks)
lines += ['',f'**Result: {passed}/{len(checks)} static checks passed.**','', 'Scope note: these are HTML parsing, source assertions and JavaScript syntax checks. They do not constitute browser click automation, real file selection, OS editor integration, Tauri runtime, database writes or physical removable-drive validation.']
(Path(__file__).resolve().parent / 'LexOrder-Materials-Workflow-v9-QA.md').write_text('\n'.join(lines), encoding='utf-8')
print('\n'.join(lines))
if passed != len(checks): sys.exit(1)
