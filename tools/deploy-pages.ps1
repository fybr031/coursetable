<#
  课程表 PWA · 一键部署到 GitHub Pages
  ------------------------------------------------------------
  不需要安装 git / gh，直接调用 GitHub REST API：
    1. 读取本地令牌（不打印、不写日志）
    2. 创建仓库（已存在则复用）
    3. 通过 Git Data API 上传全部文件（一次 commit）
    4. 开启 GitHub Pages（main 分支根目录）
    5. 轮询构建状态，输出线上网址

  用法：
    # 只演练：列出将上传的文件，不碰网络
    powershell -ExecutionPolicy Bypass -File tools\deploy-pages.ps1 -DryRun

    # 正式部署（令牌默认从 D:\DSH-data\secrets\gh-token.txt 读取）
    powershell -ExecutionPolicy Bypass -File tools\deploy-pages.ps1

  令牌：GitHub → Settings → Developer settings → Personal access tokens
        → Tokens (classic) → Generate new token，勾选 repo 即可。
  安全：令牌只用在本机内存里调用 GitHub API，不落盘、不回显、不进代码。
#>
[CmdletBinding()]
param(
  [string]$RepoName = 'coursetable',
  [string]$Root = '',
  [string]$TokenFile = 'D:\DSH-data\secrets\gh-token.txt',
  [switch]$Private,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $Root) {
  $Root = Split-Path -Parent $PSScriptRoot
}
$Root = (Resolve-Path -LiteralPath $Root).Path
if (-not (Test-Path -LiteralPath (Join-Path $Root 'index.html'))) {
  throw "根目录里没有 index.html，路径不对：$Root"
}

$ApiBase = 'https://api.github.com'
$Headers = @{
  'User-Agent' = 'coursetable-pages-deploy'
  'Accept'     = 'application/vnd.github+json'
}

# ---------------- 工具函数 ----------------

function Invoke-Gh {
  param(
    [string]$Method,
    [string]$Path,
    $Body,
    [switch]$Allow404,
    [switch]$Allow409
  )
  $params = @{
    Method      = $Method
    Uri         = ($ApiBase + $Path)
    Headers     = $Headers
    ErrorAction = 'Stop'
  }
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 12 -Compress
    $params.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $params.ContentType = 'application/json; charset=utf-8'
  }
  try {
    return Invoke-RestMethod @params
  } catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    if ($Allow404 -and $code -eq 404) { return $null }
    if ($Allow409 -and $code -eq 409) { return $null }
    $detail = ''
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
      $detail = $reader.ReadToEnd()
      $reader.Close()
    } catch { }
    throw ("GitHub API 调用失败：[{0}] {1} {2} -> HTTP {3} {4}" -f $Method, $ApiBase, $Path, $code, $detail)
  }
}

function Get-RelFiles {
  param([string]$Base)
  $skipDirs = @('.git', 'node_modules', '.tmp', 'backup')
  $files = New-Object System.Collections.ArrayList
  $all = Get-ChildItem -LiteralPath $Base -Recurse -File -Force
  foreach ($f in $all) {
    $rel = $f.FullName.Substring($Base.Length + 1)
    $relUnix = $rel.Replace('\', '/')
    $skip = $false
    foreach ($d in $skipDirs) {
      if ($relUnix -eq $d -or $relUnix.StartsWith($d + '/')) { $skip = $true; break }
    }
    if ($skip) { continue }
    if ($f.Name -like '.tmp*') { continue }
    if ($f.Name -eq 'Thumbs.db' -or $f.Name -eq 'desktop.ini') { continue }
    [void]$files.Add([PSCustomObject]@{ Rel = $relUnix; Full = $f.FullName; Size = $f.Length })
  }
  return $files
}

function Get-RepoToken {
  param([string]$File)
  if ($env:GH_TOKEN) { return $env:GH_TOKEN.Trim() }
  if (Test-Path -LiteralPath $File) {
    $t = (Get-Content -LiteralPath $File -Raw)
    return $t.Trim()
  }
  Write-Host ''
  Write-Host "没找到令牌文件：$File" -ForegroundColor Yellow
  Write-Host '可以直接粘贴令牌（输入不会回显）：' -ForegroundColor Yellow
  $sec = Read-Host -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# ---------------- 1. 收集文件 ----------------

Write-Host ''
Write-Host '==== 课程表 PWA · 部署到 GitHub Pages ====' -ForegroundColor Cyan
Write-Host "项目目录：$Root"
Write-Host "仓库名称：$RepoName  ($(if ($Private) { '私有' } else { '公开（Pages 免费版要求公开）' }))"

$files = Get-RelFiles -Base $Root
if ($files.Count -eq 0) { throw '没找到要上传的文件' }

$totalBytes = ($files | Measure-Object -Property Size -Sum).Sum
Write-Host ("待上传：{0} 个文件，共 {1:N0} KB" -f $files.Count, ($totalBytes / 1024))

if ($DryRun) {
  Write-Host ''
  Write-Host '--- DryRun：以下文件将会被上传 ---' -ForegroundColor DarkGray
  foreach ($f in $files) {
    Write-Host ("  {0,-45} {1,9:N0} B" -f $f.Rel, $f.Size)
  }
  Write-Host ''
  Write-Host '演练结束，未访问网络、未做任何改动。' -ForegroundColor Green
  return
}

# 必需文件自检
$need = @('index.html', 'manifest.webmanifest', 'sw.js', 'assets/app.js', 'assets/app.css', 'assets/parser.js', '.nojekyll')
foreach ($n in $need) {
  if (-not ($files | Where-Object { $_.Rel -eq $n })) { throw "缺少必需文件：$n" }
}

# ---------------- 2. 鉴权 ----------------

$token = Get-RepoToken -File $TokenFile
if (-not $token) { throw '令牌为空' }
if ($token -notmatch '^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)') {
  Write-Host '⚠ 令牌前缀看起来不像 GitHub token，继续尝试…' -ForegroundColor Yellow
}
$Headers['Authorization'] = "token $token"

Write-Host ''
Write-Host '[1/5] 校验令牌…' -ForegroundColor Cyan
$me = Invoke-Gh -Method GET -Path '/user'
$owner = $me.login
Write-Host "      已登录：$owner" -ForegroundColor Green

# ---------------- 3. 仓库 ----------------

Write-Host '[2/5] 准备仓库…' -ForegroundColor Cyan
$slug = "$owner/$RepoName"
$repo = Invoke-Gh -Method GET -Path "/repos/$slug" -Allow404
if (-not $repo) {
  $repo = Invoke-Gh -Method POST -Path '/user/repos' -Body @{
    name        = $RepoName
    private     = [bool]$Private
    description = '自用课程表 PWA（PWA course timetable，从教务系统导课，离线可用）'
    has_issues  = $true
    has_wiki    = $false
    auto_init   = $false
  }
  Write-Host "      已创建仓库：$($repo.html_url)" -ForegroundColor Green
} else {
  Write-Host "      仓库已存在，将追加一个新提交：$($repo.html_url)" -ForegroundColor Green
}

# ---------------- 4. 上传文件（Git Data API，一次 commit） ----------------

Write-Host '[3/5] 上传文件…' -ForegroundColor Cyan

# 关键：仓库为空时 GitHub 的 Git Data API（/git/blobs 等）一律返回 409，
# 必须先用 Contents API 写一个文件让仓库有一次提交，之后才能走 Git Data API。
$ref = Invoke-Gh -Method GET -Path "/repos/$slug/git/ref/heads/main" -Allow404
if (-not $ref) {
  Write-Host '      仓库是空的，先用 Contents API 初始化…' -ForegroundColor DarkGray
  $initBytes = [System.IO.File]::ReadAllBytes((Join-Path $Root '.nojekyll'))
  Invoke-Gh -Method PUT -Path "/repos/$slug/contents/.nojekyll" -Body @{
    message = '初始化仓库'
    content = [Convert]::ToBase64String($initBytes)
  } | Out-Null
  try { Invoke-Gh -Method PATCH -Path "/repos/$slug" -Body @{ default_branch = 'main' } | Out-Null } catch { }
  $ref = Invoke-Gh -Method GET -Path "/repos/$slug/git/ref/heads/main" -Allow404
  if (-not $ref) { throw '仓库初始化失败：仍然拿不到 main 分支' }
  Write-Host '      初始化完成' -ForegroundColor Green
}

$treeItems = New-Object System.Collections.ArrayList
$i = 0
foreach ($f in $files) {
  $i++
  $bytes = [System.IO.File]::ReadAllBytes($f.Full)
  $b64 = [Convert]::ToBase64String($bytes)
  $blob = Invoke-Gh -Method POST -Path "/repos/$slug/git/blobs" -Body @{ content = $b64; encoding = 'base64' }
  [void]$treeItems.Add(@{ path = $f.Rel; mode = '100644'; type = 'blob'; sha = $blob.sha })
  if ($i % 8 -eq 0 -or $i -eq $files.Count) {
    Write-Host ("      已上传 {0}/{1}" -f $i, $files.Count) -ForegroundColor DarkGray
  }
}

# 以远端最新提交为底（base_tree），并删除本地已不存在的远端文件，保证线上与本地一致
$treeBody = @{ tree = @($treeItems) }
if ($ref) {
  $baseCommit = Invoke-Gh -Method GET -Path "/repos/$slug/git/commits/$($ref.object.sha)"
  $treeBody['base_tree'] = $baseCommit.tree.sha

  $remoteTree = Invoke-Gh -Method GET -Path "/repos/$slug/git/trees/$($baseCommit.tree.sha)?recursive=1"
  $localSet = @{}
  foreach ($f in $files) { $localSet[$f.Rel] = $true }
  $dels = @()
  foreach ($item in $remoteTree.tree) {
    if ($item.type -eq 'blob' -and -not $localSet.ContainsKey($item.path)) {
      $dels += @{ path = $item.path; mode = '100644'; type = 'blob'; sha = $null }
    }
  }
  if ($dels.Count -gt 0) {
    foreach ($d in $dels) { [void]$treeItems.Add($d) }
    $treeBody['tree'] = @($treeItems)
    Write-Host ("      清理远端多余文件 {0} 个：{1}" -f $dels.Count, (($dels | ForEach-Object { $_.path }) -join ', ')) -ForegroundColor DarkGray
  }
}
$tree = Invoke-Gh -Method POST -Path "/repos/$slug/git/trees" -Body $treeBody

$commitMsg = '更新课程表 PWA ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
$commitBody = @{ message = $commitMsg; tree = $tree.sha }
if ($ref) { $commitBody['parents'] = @($ref.object.sha) }
$commit = Invoke-Gh -Method POST -Path "/repos/$slug/git/commits" -Body $commitBody

if ($ref) {
  Invoke-Gh -Method PATCH -Path "/repos/$slug/git/refs/heads/main" -Body @{ sha = $commit.sha; force = $true } | Out-Null
} else {
  Invoke-Gh -Method POST -Path "/repos/$slug/git/refs" -Body @{ ref = 'refs/heads/main'; sha = $commit.sha } | Out-Null
  try { Invoke-Gh -Method PATCH -Path "/repos/$slug" -Body @{ default_branch = 'main' } | Out-Null } catch { }
}
Write-Host "      已提交：$($commit.sha.Substring(0,7))  $commitMsg" -ForegroundColor Green

# ---------------- 5. 开启 Pages ----------------

Write-Host '[4/5] 开启 GitHub Pages…' -ForegroundColor Cyan
$pagesBody = @{ source = @{ branch = 'main'; path = '/' } }
$pages = Invoke-Gh -Method GET -Path "/repos/$slug/pages" -Allow404
if (-not $pages) {
  $pages = Invoke-Gh -Method POST -Path "/repos/$slug/pages" -Body $pagesBody -Allow409
  if (-not $pages) {
    $pages = Invoke-Gh -Method PUT -Path "/repos/$slug/pages" -Body $pagesBody
  }
  Write-Host '      已开启 Pages（main 分支 / 根目录）' -ForegroundColor Green
} else {
  $pages = Invoke-Gh -Method PUT -Path "/repos/$slug/pages" -Body $pagesBody
  Write-Host "      Pages 已存在，已确保指向 main 分支（状态：$($pages.status)）" -ForegroundColor Green
}

$url = $pages.html_url
if (-not $url) { $url = "https://$owner.github.io/$RepoName/" }
if (-not $url.EndsWith('/')) { $url += '/' }

# ---------------- 等待构建 ----------------

Write-Host '[5/5] 等待 Pages 构建（首次一般 30~90 秒）…' -ForegroundColor Cyan
$built = $false
$lastStatus = ''
for ($n = 0; $n -lt 60; $n++) {
  Start-Sleep -Seconds 3
  $st = Invoke-Gh -Method GET -Path "/repos/$slug/pages" -Allow404
  $status = $null
  if ($st) { $status = $st.status }
  if ($status -ne $lastStatus) {
    Write-Host ("      状态：{0}" -f ($(if ($status) { $status } else { '排队中' }))) -ForegroundColor DarkGray
    $lastStatus = $status
  }
  if ($status -eq 'built') { $built = $true; break }
  # 直接探活网址，避免 API 状态滞后
  try {
    $probe = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 3
    if ($probe.StatusCode -eq 200) { $built = $true; break }
  } catch { }
}

Write-Host ''
if ($built) {
  Write-Host '部署完成 ✅' -ForegroundColor Green
} else {
  Write-Host '提交已完成，但构建还没结束（通常再等 1 分钟就好）。' -ForegroundColor Yellow
}
Write-Host ''
Write-Host "  仓库：      https://github.com/$slug" -ForegroundColor White
Write-Host "  线上网址：  $url" -ForegroundColor White
Write-Host ''
Write-Host '手机上：用浏览器打开上面网址 → 菜单「添加到主屏幕」，之后就像 App 一样用（可离线）。' -ForegroundColor Cyan
Write-Host ''
Write-Host '提醒：这个令牌用完可以去 https://github.com/settings/tokens 撤销掉。' -ForegroundColor Yellow
Write-Host ''
