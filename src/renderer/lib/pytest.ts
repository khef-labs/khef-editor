// Whether a path is a pytest test file by pytest's default naming: basename `test_*.py`
// or `*_test.py`. Used to gate "Run/Debug Tests in File" — no AST discovery in the MVP.
export function isPytestFile(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return /^test_.+\.py$/.test(base) || /.+_test\.py$/.test(base)
}
