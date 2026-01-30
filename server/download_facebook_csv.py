#!/usr/bin/env python3
"""
Facebook CSV Download and Parser
Downloads CSV from Facebook's lookaside URL and returns parsed JSON data
"""

import sys
import json
import requests
import pandas as pd
from io import StringIO

def download_and_parse_csv(report_run_id: str, access_token: str) -> dict:
    """
    Download CSV from Facebook and parse it into JSON format
    
    Args:
        report_run_id: Facebook report run ID
        access_token: Facebook API access token
        
    Returns:
        dict with 'success', 'data', and optional 'error' keys
    """
    try:
        # Construct Facebook lookaside URL
        url = f"https://lookaside.facebook.com/ads/ads_insights/download_report/business/?report_run_id={report_run_id}&access_token={access_token}"
        
        # Download CSV with timeout
        response = requests.get(url, timeout=120)
        response.raise_for_status()
        
        # Parse CSV with pandas
        csv_data = StringIO(response.text)
        df = pd.read_csv(csv_data)
        
        # Convert DataFrame to list of dictionaries
        # Handle NaN values by converting to None (JSON null)
        records = df.where(pd.notnull(df), None).to_dict('records')
        
        return {
            'success': True,
            'data': records,
            'row_count': len(records),
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
