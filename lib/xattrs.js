const { execFileSync } = require('child_process');

const PY_READ = [
  'import os,sys,json',
  'try:',
  '  v=os.getxattr(sys.argv[1],"user.xdg.tags").decode()',
  '  print(json.dumps([t.strip() for t in v.split(",") if t.strip()]))',
  'except:',
  '  print("[]")',
].join('\n');

const PY_WRITE = [
  'import os,sys',
  'p,v=sys.argv[1],sys.argv[2]',
  'if v: os.setxattr(p,"user.xdg.tags",v.encode())',
  'else:',
  '  try: os.removexattr(p,"user.xdg.tags")',
  '  except: pass',
].join('\n');

function readTags(filePath) {
  try {
    const out = execFileSync('python3', ['-c', PY_READ, filePath],
      { encoding: 'utf8', timeout: 2000 });
    return JSON.parse(out.trim());
  } catch { return []; }
}

function writeTags(filePath, tags) {
  try {
    execFileSync('python3', ['-c', PY_WRITE, filePath, tags.join(',')],
      { timeout: 2000 });
  } catch (err) {
    console.warn(`writeTags failed for ${filePath}:`, err.message);
  }
}

module.exports = { readTags, writeTags };
