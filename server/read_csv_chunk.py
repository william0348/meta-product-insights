#!/usr/bin/env python3
"""
CSV Chunk Reader
Reads a specific chunk of rows from a CSV file for pagination
"""

import sys
import json
import pandas as pd

def read_csv_chunk(file_path: str, offset: int, limit: int) -> dict:
    """
    Read a chunk of rows from CSV file
    
    Args:
        file_path: Path to CSV file
        offset: Starting row index
        limit: Number of rows to read
        
    Returns:
        dict with 'success', 'data', 'has_more' keys
    """
    try:
        # Read CSV file
        df = pd.read_csv(file_path)
        total_rows = len(df)
        
        # Get the requested chunk
        end_index = min(offset + limit, total_rows)
        chunk_df = df.iloc[offset:end_index]
        
        # Convert to records
        records = chunk_df.where(pd.notnull(chunk_df), None).to_dict('records')
        
        return {
            'success': True,
            'data': records,
            'has_more': end_index < total_rows,
            'total_rows': total_rows,
            'returned_rows': len(records)
        }
        
    except FileNotFoundError:
        return {
            'success': False,
            'error': f'CSV file not found: {file_path}'
        }
    except pd.errors.ParserError as e:
        return {
            'success': False,
            'error': f'CSV parsing error: {str(e)}'
        }
    except Exception as e:
        return {
            'success': False,
            'error': f'Unexpected error: {str(e)}'
        }

def main():
    """Main entry point for CLI usage"""
    if len(sys.argv) != 4:
        print(json.dumps({
            'success': False,
            'error': 'Usage: python read_csv_chunk.py <file_path> <offset> <limit>'
        }))
        sys.exit(1)
    
    file_path = sys.argv[1]
    offset = int(sys.argv[2])
    limit = int(sys.argv[3])
    
    result = read_csv_chunk(file_path, offset, limit)
    print(json.dumps(result))
    
    sys.exit(0 if result['success'] else 1)

if __name__ == '__main__':
    main()
