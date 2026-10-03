$ErrorActionPreference = 'Stop'

Write-Host 'Starting Distributed Rate Limiting System...' -ForegroundColor Cyan
docker compose up --build -d

Write-Host ''
Write-Host 'Application started.' -ForegroundColor Green
Write-Host 'Open: http://localhost:3001' -ForegroundColor Yellow
Write-Host 'Redis: localhost:6379' -ForegroundColor DarkGray
Write-Host 'Use .\stop.ps1 to stop the application.' -ForegroundColor DarkGray
