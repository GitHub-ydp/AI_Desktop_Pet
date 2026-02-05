#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
数据清洗辅助脚本
"""
import pandas as pd
import numpy as np

class DataCleaner:
    """数据清洗工具类"""
    
    def __init__(self, data):
        """初始化"""
        if isinstance(data, str):
            self.df = pd.read_csv(data)
        else:
            self.df = data.copy()
        self.original_shape = self.df.shape
        self.log = []
    
    def analyze(self):
        """分析数据质量"""
        report = {
            'shape': self.df.shape,
            'columns': list(self.df.columns),
            'dtypes': self.df.dtypes.to_dict(),
            'missing': self.df.isnull().sum().to_dict(),
            'duplicates': self.df.duplicated().sum(),
            'memory': f"{self.df.memory_usage(deep=True).sum() / 1024:.2f} KB"
        }
        return report
    
    def handle_missing(self, strategy='drop', **kwargs):
        """处理缺失值"""
        before = self.df.isnull().sum().sum()
        
        if strategy == 'drop':
            self.df = self.df.dropna()
        elif strategy == 'fillna':
            fill_value = kwargs.get('fill_value', 0)
            self.df = self.df.fillna(fill_value)
        elif strategy == 'ffill':
            self.df = self.df.fillna(method='ffill')
        elif strategy == 'mean':
            numeric_cols = self.df.select_dtypes(include=[np.number]).columns
            self.df[numeric_cols] = self.df[numeric_cols].fillna(
                self.df[numeric_cols].mean()
            )
        
        after = self.df.isnull().sum().sum()
        self.log.append(f"处理缺失值: {before} -> {after}")
        return self
    
    def remove_duplicates(self, subset=None):
        """删除重复数据"""
        before = len(self.df)
        self.df = self.df.drop_duplicates(subset=subset)
        after = len(self.df)
        self.log.append(f"删除重复行: {before - after} 行")
        return self
    
    def handle_outliers(self, column, method='iqr'):
        """处理异常值"""
        if method == 'iqr':
            Q1 = self.df[column].quantile(0.25)
            Q3 = self.df[column].quantile(0.75)
            IQR = Q3 - Q1
            lower = Q1 - 1.5 * IQR
            upper = Q3 + 1.5 * IQR
            before = len(self.df)
            self.df = self.df[
                (self.df[column] >= lower) & 
                (self.df[column] <= upper)
            ]
            after = len(self.df)
            self.log.append(f"处理异常值 {column}: 删除 {before - after} 行")
        return self
    
    def standardize_text(self, columns, operation='strip'):
        """标准化文本"""
        for col in columns:
            if operation == 'strip':
                self.df[col] = self.df[col].str.strip()
            elif operation == 'lower':
                self.df[col] = self.df[col].str.lower()
            elif operation == 'upper':
                self.df[col] = self.df[col].str.upper()
        self.log.append(f"文本标准化: {', '.join(columns)}")
        return self
    
    def convert_types(self, type_map):
        """转换数据类型"""
        for col, dtype in type_map.items():
            try:
                if dtype == 'numeric':
                    self.df[col] = pd.to_numeric(self.df[col], errors='coerce')
                elif dtype == 'datetime':
                    self.df[col] = pd.to_datetime(self.df[col], errors='coerce')
                else:
                    self.df[col] = self.df[col].astype(dtype)
                self.log.append(f"类型转换: {col} -> {dtype}")
            except Exception as e:
                self.log.append(f"类型转换失败: {col} - {str(e)}")
        return self
    
    def get_report(self):
        """生成清洗报告"""
        report = {
            'original_shape': self.original_shape,
            'final_shape': self.df.shape,
            'rows_removed': self.original_shape[0] - self.df.shape[0],
            'operations': self.log,
            'quality_metrics': self.analyze()
        }
        return report
    
    def save(self, filename):
        """保存清洗后的数据"""
        self.df.to_csv(filename, index=False)
        self.log.append(f"数据已保存: {filename}")
        return self

if __name__ == '__main__':
    print("数据清洗工具已加载")

