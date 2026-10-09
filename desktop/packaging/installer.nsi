Unicode true
!include "MUI2.nsh"
Name "拾室素材采集"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\ShishiCollector"
InstallDirRegKey HKCU "Software\ShishiCollector" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID zlib
!define MUI_ICON "${STAGE}\resources\app\assets\app-icon.ico"
!define MUI_UNICON "${STAGE}\resources\app\assets\app-icon.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Section "安装"
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*"
  WriteUninstaller "$INSTDIR\卸载.exe"
  CreateShortcut "$DESKTOP\拾室素材采集.lnk" "$INSTDIR\拾室素材采集.exe" "" "$INSTDIR\resources\app\assets\app-icon.ico"
  CreateDirectory "$SMPROGRAMS\拾室素材采集"
  CreateShortcut "$SMPROGRAMS\拾室素材采集\拾室素材采集.lnk" "$INSTDIR\拾室素材采集.exe" "" "$INSTDIR\resources\app\assets\app-icon.ico"
  CreateShortcut "$SMPROGRAMS\拾室素材采集\卸载.lnk" "$INSTDIR\卸载.exe"
  WriteRegStr HKCU "Software\ShishiCollector" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShishiCollector" "DisplayName" "拾室素材采集"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShishiCollector" "DisplayVersion" "0.2.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShishiCollector" "UninstallString" '$\"$INSTDIR\卸载.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShishiCollector" "DisplayIcon" "$INSTDIR\拾室素材采集.exe"
SectionEnd
Section "Uninstall"
  Delete "$DESKTOP\拾室素材采集.lnk"
  RMDir /r "$SMPROGRAMS\拾室素材采集"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\ShishiCollector"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShishiCollector"
SectionEnd
