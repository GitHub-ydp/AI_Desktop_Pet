"""
GLM-OCR 图片识别脚本
使用智谱AI的GLM-4V-Flash模型进行图片OCR识别
"""

import argparse
import base64
import os
from pathlib import Path

from zhipuai import ZhipuAI


def encode_image_to_base64(image_path: str) -> str:
    """将图片文件编码为base64格式"""
    with open(image_path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')


def ocr_with_zhipuai(client: ZhipuAI, image_path: str, prompt: str = "请识别这张图片中的所有文字内容，包括表格数据。请以结构化的方式输出，保持原有的格式和布局。") -> str:
    """
    使用智谱AI的GLM-4V模型进行OCR识别

    Args:
        client: ZhipuAI客户端实例
        image_path: 图片文件路径
        prompt: 提示词

    Returns:
        识别结果文本
    """
    # 读取图片并转换为base64
    base64_image = encode_image_to_base64(image_path)

    # 调用API
    response = client.chat.completions.create(
        model="glm-4v-flash",  # 使用GLM-4V-Flash模型，支持OCR
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{base64_image}"
                        }
                    },
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ],
        temperature=0.0,
        top_p=0.7,
    )

    # 返回识别结果
    return response.choices[0].message.content


def save_result(image_path: str, result: str, output_dir: str = None):
    """
    保存OCR识别结果到文件

    Args:
        image_path: 原图片路径
        result: 识别结果
        output_dir: 输出目录，默认为图片所在目录
    """
    if output_dir is None:
        output_dir = os.path.dirname(image_path)

    # 生成输出文件名
    image_name = Path(image_path).stem
    output_path = os.path.join(output_dir, f"{image_name}_ocr_result.txt")

    # 保存结果
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(f"图片: {image_path}\n")
        f.write(f"{'='*60}\n")
        f.write(result)
        f.write(f"\n{'='*60}\n")

    print(f"[OK] 识别结果已保存到: {output_path}")


def main():
    """主函数"""
    # 解析命令行参数
    parser = argparse.ArgumentParser(description='GLM-OCR 图片识别工具')
    parser.add_argument('--api-key', type=str, help='智谱AI API Key')
    parser.add_argument('--images', type=str, nargs='+', help='要识别的图片路径（可选，默认识别307.png和308.png）')
    args = parser.parse_args()

    print("="*60)
    print("GLM-OCR 图片识别工具")
    print("="*60)

    # 获取API Key：命令行参数 > 环境变量
    api_key = args.api_key or os.environ.get("ZHIPUAI_API_KEY")
    if not api_key:
        print("\n错误: 未找到API Key!")
        print("请通过以下方式之一提供API Key:")
        print("  方式1: 设置环境变量 ZHIPUAI_API_KEY")
        print("  方式2: 使用命令行参数 --api-key YOUR_API_KEY")
        print("\n示例:")
        print("  python glm_ocr_demo.py --api-key YOUR_API_KEY")
        return

    # 初始化客户端
    try:
        client = ZhipuAI(api_key=api_key)
        print("\n[OK] 客户端初始化成功")
    except Exception as e:
        print(f"\n[FAIL] 客户端初始化失败: {e}")
        return

    # 获取当前目录
    current_dir = os.path.dirname(os.path.abspath(__file__))

    # 指定要识别的图片
    if args.images:
        image_files = args.images
    else:
        # 默认识别307.png和308.png
        image_files = [
            os.path.join(current_dir, "307.png"),
            os.path.join(current_dir, "308.png"),
        ]

    # 检查文件是否存在
    existing_images = [f for f in image_files if os.path.exists(f)]

    if not existing_images:
        print(f"\n[FAIL] 未找到图片文件")
        return

    print(f"\n找到 {len(existing_images)} 张图片待识别")

    # 遍历识别每张图片
    for i, image_path in enumerate(existing_images, 1):
        print(f"\n[{i}/{len(existing_images)}] 正在识别: {os.path.basename(image_path)}")

        try:
            # 调用OCR识别
            result = ocr_with_zhipuai(client, image_path)

            # 保存结果
            save_result(image_path, result)

            # 打印预览
            preview = result[:200] + "..." if len(result) > 200 else result
            print(f"\n识别结果预览:\n{preview}\n")

        except Exception as e:
            print(f"[FAIL] 识别失败: {e}")
            continue

    print("\n" + "="*60)
    print("识别完成!")
    print("="*60)


if __name__ == "__main__":
    main()
