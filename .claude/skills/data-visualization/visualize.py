#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
数据可视化辅助脚本
"""
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd
import numpy as np

# 设置中文显示
plt.rcParams['font.sans-serif'] = ['SimHei', 'Arial Unicode MS']
plt.rcParams['axes.unicode_minus'] = False

def auto_visualize(data, chart_type='auto', **kwargs):
    """
    自动选择合适的图表类型进行可视化
    
    Args:
        data: DataFrame 或文件路径
        chart_type: 图表类型 ('auto', 'line', 'bar', 'pie', 'scatter', 'heatmap')
        **kwargs: 其他参数
    """
    if isinstance(data, str):
        data = pd.read_csv(data)
    
    if chart_type == 'auto':
        chart_type = recommend_chart_type(data)
    
    if chart_type == 'line':
        create_line_chart(data, **kwargs)
    elif chart_type == 'bar':
        create_bar_chart(data, **kwargs)
    elif chart_type == 'pie':
        create_pie_chart(data, **kwargs)
    elif chart_type == 'scatter':
        create_scatter_chart(data, **kwargs)
    elif chart_type == 'heatmap':
        create_heatmap(data, **kwargs)

def recommend_chart_type(data):
    """根据数据特征推荐图表类型"""
    n_cols = len(data.columns)
    
    if n_cols == 2:
        if pd.api.types.is_datetime64_any_dtype(data.iloc[:, 0]):
            return 'line'
        elif pd.api.types.is_numeric_dtype(data.iloc[:, 1]):
            return 'bar'
    elif n_cols == 1:
        return 'pie'
    
    return 'bar'

def create_line_chart(data, x=None, y=None, title='', **kwargs):
    """创建折线图"""
    plt.figure(figsize=(10, 6))
    if x and y:
        plt.plot(data[x], data[y], marker='o')
    else:
        plt.plot(data.iloc[:, 0], data.iloc[:, 1], marker='o')
    plt.title(title or '折线图')
    plt.xlabel(x or data.columns[0])
    plt.ylabel(y or data.columns[1])
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    return plt.gcf()

def create_bar_chart(data, x=None, y=None, title='', **kwargs):
    """创建柱状图"""
    plt.figure(figsize=(10, 6))
    if x and y:
        plt.bar(data[x], data[y])
    else:
        plt.bar(data.iloc[:, 0], data.iloc[:, 1])
    plt.title(title or '柱状图')
    plt.xlabel(x or data.columns[0])
    plt.ylabel(y or data.columns[1])
    plt.xticks(rotation=45)
    plt.tight_layout()
    return plt.gcf()

def create_pie_chart(data, labels=None, values=None, title='', **kwargs):
    """创建饼图"""
    plt.figure(figsize=(8, 8))
    if labels and values:
        plt.pie(data[values], labels=data[labels], autopct='%1.1f%%')
    else:
        plt.pie(data.iloc[:, 1], labels=data.iloc[:, 0], autopct='%1.1f%%')
    plt.title(title or '饼图')
    plt.tight_layout()
    return plt.gcf()

def create_scatter_chart(data, x=None, y=None, title='', **kwargs):
    """创建散点图"""
    plt.figure(figsize=(10, 6))
    if x and y:
        plt.scatter(data[x], data[y], alpha=0.6)
    else:
        plt.scatter(data.iloc[:, 0], data.iloc[:, 1], alpha=0.6)
    plt.title(title or '散点图')
    plt.xlabel(x or data.columns[0])
    plt.ylabel(y or data.columns[1])
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    return plt.gcf()

def create_heatmap(data, title='', **kwargs):
    """创建热力图"""
    plt.figure(figsize=(10, 8))
    sns.heatmap(data.corr(), annot=True, fmt='.2f', cmap='coolwarm')
    plt.title(title or '热力图')
    plt.tight_layout()
    return plt.gcf()

if __name__ == '__main__':
    print("数据可视化工具已加载")

