# 环带突击 · Orbital Spear

一段约 60 秒循环播放的实时 3D 科幻短片。突击舰「镇星」号横在气态巨行星的环带前，舰载机甲从甲板弹射，加入编队。场景使用 three.js r180 和 WebGL2 渲染，播放时可切换到自由相机。

## 运行

下载仓库并解压，用支持 WebGL2 的桌面浏览器打开 [`dist/index.html`](dist/index.html)。成品是单个 HTML 文件，包含渲染库和素材，可离线播放。

| 操作 | 键位 |
| --- | --- |
| 跳转到预设机位 | `1`–`6` |
| 切换电影模式和自由相机 | `F` |
| 自由相机移动、升降、加速 | `WASD`、`Q` / `E`、`Shift` |
| 自由相机转向、调速 | 鼠标拖拽、滚轮 |
| 暂停或继续 | `P` 或空格 |
| 收起或展开 HUD | `H` |

## 构建

安装 Python 3 和 Node.js，在仓库根目录运行：

```sh
python tools/build.py
```

脚本用 `node --check` 检查各源码模块及拼接后的脚本，再将 `src/`、`vendor/` 和 `机器人.glb` 打包为 `dist/index.html`。镜头和剧情节拍见 [FILM.md](FILM.md)。

## 许可与素材来源

- 项目源码、文档及项目作者对机甲资产享有的权利采用 [MIT 许可](LICENSE)。
- three.js r180 采用 MIT 许可，声明见 [vendor/LICENSE](vendor/LICENSE)。
- 星云贴图来自 Screaming Brain Studios 的 [Seamless Space Backgrounds](https://screamingbrainstudios.itch.io/seamless-space-backgrounds)，采用 CC0。
- `机器人.glb` 是本项目使用腾讯混元 3D 生成的机甲资产。生成内容的权利归属见 [腾讯混元 3D 服务协议](https://rule.tencent.com/rule/202501080004) 第 5 节。
