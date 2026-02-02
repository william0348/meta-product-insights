#!/usr/bin/env python3
"""
Facebook CSV Download and Parser
Downloads CSV from Facebook's lookaside URL and returns parsed JSON data
"""

import sys
import json
import requests
import pandas as pd
import os
from pathlib import Path
from datetime import datetime

def download_and_parse_csv(report_run_id: str, access_token: str) -> dict:
    """
    Download CSV from Facebook and save to file storage
    
    Args:
        report_run_id: Facebook report run ID
        access_token: Facebook API access token
        
    Returns:
        dict with 'success', 'file_path', 'preview_data' (first 100 rows), and optional 'error' keys
    """
    try:
        # Construct Facebook lookaside URL
        url = f"https://lookaside.facebook.com/ads/ads_insights/download_report/business/?report_run_id={report_run_id}&access_token={access_token}"
        
        # Create storage directory
        storage_dir = Path('/home/ubuntu/meta-product-insights/storage/csv_cache')
        storage_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate unique filename
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"report_{report_run_id}_{timestamp}.csv"
        file_path = storage_dir / filename
        
        # Download CSV with timeout
        response = requests.get(url, timeout=120)
        response.raise_for_status()
        
        # Save raw CSV to file
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(response.text)
        
        # Parse CSV to get preview and metadata
        df = pd.read_csv(file_path)
        
        # Get first 100 rows as preview
        preview_df = df.head(100)
        preview_records = preview_df.where(pd.notnull(preview_df), None).to_dict('records')
        
        return {
            'success': True,
            'file_path': str(file_path),
            'preview_data': preview_records,
            'total_rows': len(df),
            'preview_rows': len(preview_records),
            'columns': list(df.columns)
        }
        
    except requests.exceptions.HTTPError as e:
        return {
            'success': False,
            'error': f'HTTP Error {e.response.status_code}: {e.response.reason}',
            'status_code': e.response.status_code
        }
    except requests.exceptions.Timeout:
        return {
            'success': False,
            'error': 'Request timeout - CSV download took too long'
        }
    except requests.exceptions.RequestException as e:
        return {
            'success': False,
            'error': f'Network error: {str(e)}'
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
    if len(sys.argv) != 3:
        print(json.dumps({
            'success': False,
            'error': 'Usage: python download_facebook_csv.py <report_run_id> <access_token>'
        }))
        sys.exit(1)
    
    report_run_id = sys.argv[1]
    access_token = sys.argv[2]
    
    result = download_and_parse_csv(report_run_id, access_token)
    print(json.dumps(result))
    
    sys.exit(0 if result['success'] else 1)

if __name__ == '__main__':
    main()
