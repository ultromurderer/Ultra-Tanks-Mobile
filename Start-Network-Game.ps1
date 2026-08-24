param(
    [ValidateSet('ru','eng')]
    [string]$Language = 'ru'
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$English = ($Language -eq 'eng')
$RequiredMajor = 18
$NodePackageId = 'OpenJS.NodeJS.LTS'

function L {
    param([string]$Ru, [string]$En)
    if ($script:English) { return $En }
    return $Ru
}

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    if ($machinePath) { $parts += $machinePath }
    if ($userPath) { $parts += $userPath }
    $env:Path = ($parts -join ';')
}

function Add-CandidatePath {
    param(
        [System.Collections.Generic.List[string]]$List,
        [string]$Path
    )
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    if (-not $List.Contains($Path)) { $List.Add($Path) }
}

function Get-UsableNode {
    $candidatePaths = New-Object 'System.Collections.Generic.List[string]'

    try {
        $command = Get-Command node.exe -ErrorAction Stop
        if ($command -and $command.Source) {
            Add-CandidatePath -List $candidatePaths -Path $command.Source
        }
    } catch {}

    $programFiles = [Environment]::GetEnvironmentVariable('ProgramFiles')
    if ($programFiles) {
        Add-CandidatePath -List $candidatePaths -Path (Join-Path $programFiles 'nodejs\node.exe')
    }

    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if ($programFilesX86) {
        Add-CandidatePath -List $candidatePaths -Path (Join-Path $programFilesX86 'nodejs\node.exe')
    }

    $localAppData = [Environment]::GetEnvironmentVariable('LOCALAPPDATA')
    if ($localAppData) {
        Add-CandidatePath -List $candidatePaths -Path (Join-Path $localAppData 'Programs\nodejs\node.exe')
    }

    $best = $null
    foreach ($path in $candidatePaths) {
        if (-not (Test-Path -LiteralPath $path)) { continue }
        try {
            $versionText = (& $path --version 2>$null).Trim()
            if ($versionText -match '^v(?<major>\d+)') {
                $major = [int]$Matches['major']
                if (($null -eq $best) -or ($major -gt $best.Major)) {
                    $best = [PSCustomObject]@{
                        Path = $path
                        Version = $versionText
                        Major = $major
                    }
                }
            }
        } catch {}
    }

    return $best
}

function Get-LanIPv4Addresses {
    $addresses = New-Object 'System.Collections.Generic.List[string]'

    try {
        $netAddresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -and
                $_.IPAddress -ne '127.0.0.1' -and
                -not $_.IPAddress.StartsWith('169.254.') -and
                $_.AddressState -ne 'Duplicate'
            } |
            Sort-Object -Property InterfaceMetric, SkipAsSource

        foreach ($entry in $netAddresses) {
            if (-not $addresses.Contains($entry.IPAddress)) {
                $addresses.Add($entry.IPAddress)
            }
        }
    } catch {}

    if ($addresses.Count -eq 0) {
        try {
            $hostAddresses = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName())
            foreach ($entry in $hostAddresses) {
                if ($entry.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { continue }
                $ip = $entry.IPAddressToString
                if ($ip -eq '127.0.0.1' -or $ip.StartsWith('169.254.')) { continue }
                if (-not $addresses.Contains($ip)) { $addresses.Add($ip) }
            }
        } catch {}
    }

    return @($addresses)
}

function Show-NetworkAddresses {
    $port = 8765
    $hostUrl = "http://localhost:$port/Ultra%20Tanks.html"
    $ips = @(Get-LanIPv4Addresses)
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $primaryUrl = $null

    $lines.Add((L 'ULTRA TANKS - АДРЕСА ДЛЯ ПОДКЛЮЧЕНИЯ' 'ULTRA TANKS - CONNECTION ADDRESSES'))
    $lines.Add('')
    $lines.Add("$(L 'Хост' 'Host'): $hostUrl")

    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host (L ' ULTRA TANKS - АДРЕСА ДЛЯ ОСТАЛЬНЫХ ИГРОКОВ' ' ULTRA TANKS - ADDRESSES FOR OTHER PLAYERS') -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host "$(L 'На этом компьютере' 'On this computer'): $hostUrl" -ForegroundColor Gray

    if ($ips.Count -gt 0) {
        Write-Host ''
        Write-Host (L 'ОСТАЛЬНЫЕ ИГРОКИ ОТКРЫВАЮТ В БРАУЗЕРЕ:' 'OTHER PLAYERS OPEN THIS ADDRESS IN A BROWSER:') -ForegroundColor Yellow
        foreach ($ip in $ips) {
            $url = "http://${ip}:$port/Ultra%20Tanks.html"
            if ([string]::IsNullOrWhiteSpace($primaryUrl)) { $primaryUrl = $url }
            Write-Host ''
            Write-Host "  >>> $url" -ForegroundColor Cyan
            $lines.Add("$(L 'Игроки 2–3' 'Players 2-3'): $url")
        }

        try {
            Set-Clipboard -Value $primaryUrl -ErrorAction Stop
            Write-Host ''
            Write-Host (L 'Ссылка скопирована в буфер обмена.' 'The link has been copied to the clipboard.') -ForegroundColor Green
            $lines.Add('')
            $lines.Add("$(L 'Скопировано в буфер' 'Copied to clipboard'): $primaryUrl")
        } catch {}
    } else {
        Write-Host ''
        Write-Host (L 'IPv4-адрес локальной сети автоматически не найден.' 'The LAN IPv4 address could not be detected automatically.') -ForegroundColor Red
        Write-Host (L 'Выполни ipconfig и используй строку IPv4-адрес с портом :8765.' 'Run ipconfig and use the IPv4 address followed by port :8765.') -ForegroundColor Yellow
        $lines.Add((L 'IPv4-адрес автоматически не найден. Используй ipconfig.' 'IPv4 address was not detected automatically. Use ipconfig.'))
    }

    $addressFileName = if ($English) { 'ADDRESS FOR OTHER PLAYERS.txt' } else { 'АДРЕС ДЛЯ ОСТАЛЬНЫХ ИГРОКОВ.txt' }
    $addressFolder = Join-Path $PSScriptRoot $Language
    $addressFile = Join-Path $addressFolder $addressFileName
    try {
        [System.IO.File]::WriteAllLines($addressFile, $lines, [System.Text.Encoding]::UTF8)
        Write-Host ''
        Write-Host "$(L 'Адрес также сохранён в файл' 'The address was also saved to'): $addressFile" -ForegroundColor DarkGray
    } catch {}
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host ''

    return [PSCustomObject]@{
        PrimaryUrl = $primaryUrl
        AddressFile = $addressFile
    }
}

function Show-AddressPopup {
    param([string]$Url)

    if ([string]::IsNullOrWhiteSpace($Url)) { return }

    try {
        $escapedUrl = $Url.Replace("'", "''")
        $popupText = if ($English) {
            "Address for other players:`r`n`r`n$escapedUrl`r`n`r`nThe link is already copied to the clipboard."
        } else {
            "Адрес для остальных игроков:`r`n`r`n$escapedUrl`r`n`r`nСсылка уже скопирована в буфер обмена."
        }
        $popupTitle = if ($English) { 'Ultra Tanks - connection' } else { 'Ultra Tanks — подключение' }
        $escapedText = $popupText.Replace("'", "''")
        $escapedTitle = $popupTitle.Replace("'", "''")
        $popupScript = @"
Add-Type -AssemblyName System.Windows.Forms
try { [System.Windows.Forms.Clipboard]::SetText('$escapedUrl') } catch {}
[System.Windows.Forms.MessageBox]::Show(
    '$escapedText',
    '$escapedTitle',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null
"@
        $bytes = [System.Text.Encoding]::Unicode.GetBytes($popupScript)
        $encoded = [Convert]::ToBase64String($bytes)
        Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoLogo','-NoProfile','-EncodedCommand',$encoded) | Out-Null
    } catch {}
}

function Start-UltraTanksServer {
    param([string]$NodePath)

    Write-Host ''
    Write-Host "$(L 'Node.js найден' 'Node.js found'): $(& $NodePath --version)" -ForegroundColor Green
    $addressInfo = Show-NetworkAddresses
    if ($addressInfo -and $addressInfo.PrimaryUrl) {
        Show-AddressPopup -Url $addressInfo.PrimaryUrl
    }
    Write-Host (L 'Запускаю сервер Ultra Tanks...' 'Starting the Ultra Tanks server...') -ForegroundColor Green
    Write-Host (L 'Не закрывай это окно до конца сетевой игры.' 'Do not close this window until the network game is finished.') -ForegroundColor Yellow
    Write-Host (L 'Если Windows запросит доступ Node.js к сети — разреши доступ для частных сетей.' 'If Windows asks for Node.js network access, allow access on private networks.') -ForegroundColor Yellow
    Write-Host ''
    & $NodePath (Join-Path $PSScriptRoot 'server.js')
    return $LASTEXITCODE
}

try {
    Refresh-ProcessPath
    $node = Get-UsableNode

    if (($null -ne $node) -and ($node.Major -ge $RequiredMajor)) {
        exit (Start-UltraTanksServer -NodePath $node.Path)
    }

    Write-Host ''
    if ($null -ne $node) {
        Write-Host "$(L 'Обнаружена устаревшая версия Node.js' 'An outdated Node.js version was found'): $($node.Version)." -ForegroundColor Yellow
    } else {
        Write-Host (L 'Node.js не найден.' 'Node.js was not found.') -ForegroundColor Yellow
    }
    Write-Host "$(L 'Для сетевой игры требуется Node.js' 'Network play requires Node.js') $RequiredMajor $(L 'или новее.' 'or newer.')" -ForegroundColor Yellow
    Write-Host (L 'Дополнительные npm-пакеты игре не нужны.' 'No additional npm packages are required.') -ForegroundColor DarkGray
    Write-Host ''

    $prompt = L 'Установить актуальную LTS-версию Node.js автоматически? [Y/N]' 'Install the current Node.js LTS version automatically? [Y/N]'
    $answer = Read-Host $prompt
    if ($answer -notmatch '^(y|yes|д|да)$') {
        Write-Host (L 'Установка отменена. Сервер не запущен.' 'Installation cancelled. The server was not started.') -ForegroundColor Yellow
        exit 1
    }

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($null -eq $winget) {
        Write-Host ''
        Write-Host (L 'Windows Package Manager (winget) не найден.' 'Windows Package Manager (winget) was not found.') -ForegroundColor Red
        Write-Host (L 'Открываю официальную страницу Node.js. Установи LTS-версию и снова запусти этот файл.' 'Opening the official Node.js page. Install the LTS version and run this file again.') -ForegroundColor Yellow
        Start-Process 'https://nodejs.org/en/download'
        exit 1
    }

    Write-Host ''
    Write-Host (L 'Устанавливаю Node.js LTS через Windows Package Manager...' 'Installing Node.js LTS through Windows Package Manager...') -ForegroundColor Cyan
    Write-Host (L 'Windows может показать запрос контроля учётных записей.' 'Windows may display a User Account Control prompt.') -ForegroundColor DarkGray
    Write-Host ''

    & $winget.Source install --id $NodePackageId --exact --source winget --accept-package-agreements --accept-source-agreements
    $wingetExitCode = $LASTEXITCODE

    Refresh-ProcessPath
    Start-Sleep -Seconds 2
    $node = Get-UsableNode

    if (($null -eq $node) -or ($node.Major -lt $RequiredMajor)) {
        Write-Host ''
        Write-Host "$(L 'Автоматическая установка не завершилась корректно (код winget' 'Automatic installation did not complete successfully (winget code'): $wingetExitCode)." -ForegroundColor Red
        Write-Host (L 'Открываю официальную страницу Node.js. Установи LTS-версию и повтори запуск.' 'Opening the official Node.js page. Install the LTS version and try again.') -ForegroundColor Yellow
        Start-Process 'https://nodejs.org/en/download'
        exit 1
    }

    Write-Host ''
    Write-Host "Node.js $($node.Version) $(L 'успешно установлен.' 'was installed successfully.')" -ForegroundColor Green
    exit (Start-UltraTanksServer -NodePath $node.Path)
}
catch {
    Write-Host ''
    Write-Host (L 'Ошибка запуска сетевой игры:' 'Network game startup error:') -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
