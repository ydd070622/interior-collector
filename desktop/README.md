# 拾室素材采集

Windows 桌面软件。直接使用请下载 Releases 的 desktop 软件 ZIP，解压后双击“拾室素材采集.exe”，保持其余文件完整。

支持多关键词（中文或英文分号分隔）、每词每站篇数、自定义网站、网站登录保存、风格素材库、重复内容合并、原文链接 HTML、缓存缩略图和一键停止。读取失败会自动重试并继续后续队列。

素材原图只保存一份。一个案例可关联多个风格标签，文件夹保留在首次风格下。完全相同图片通过内容哈希识别；重新压缩、裁剪或加水印的图片尚不支持相似度去重。自定义网站的复杂结构可能需要专门适配。

## 源码运行

安装 Node.js，然后在 desktop 目录执行：

```sh
node prepare-runtime.cjs
npm install
npm start
```

prepare-runtime.cjs 从仓库根目录复制现有模型和运行库；克隆时请安装 Git LFS 并执行 git lfs pull。

```sh
node --test tests/*.test.cjs
```

网站 Cookie、素材和个人历史存放在本机用户数据目录，不包含在仓库或软件安装包中。
