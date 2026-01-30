# 图标文件说明

## 当前状态
目前使用的是占位图标文件。

## 如何替换图标

### Windows图标 (icon.ico)
1. 准备一个 256x256 像素的 PNG 图片
2. 使用在线工具转换为 .ico 格式：https://www.icoconverter.com/
3. 将生成的 icon.ico 文件放在这个目录下
4. 确保 package.json 中的配置正确：
   ```json
   "build": {
     "win": {
       "icon": "assets/icon.ico"
     }
   }
   ```

### macOS图标 (icon.icns)
1. 准备一个 1024x1024 像素的 PNG 图片
2. 使用 macOS 自带的 iconutil 或在线工具转换
3. 将生成的 icon.icns 文件放在这个目录下

### 通用图标 (icon.png)
- 推荐尺寸：512x512 或 1024x1024
- 格式：PNG with transparency
- 文件名：icon.png

## 推荐的图标设计
- 可爱的宠物emoji风格
- 简洁明了的线条
- 柔和的配色
- 在不同尺寸下都清晰可辨

## 临时解决方案
在找到合适的图标之前，你可以：
1. 使用网络上的免费图标资源（注意版权）
2. 使用emoji作为临时图标（🐱）
3. 使用AI生成工具创建图标
