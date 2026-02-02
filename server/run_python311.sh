#!/bin/bash
# Wrapper script to run Python 3.11 with clean environment
# This prevents Python 3.13 modules from being loaded

# Clear all Python-related environment variables
unset PYTHONPATH
unset PYTHONHOME
unset PYTHON_VERSION
unset UV_PYTHON

# Execute Python 3.11 in isolated mode (-I flag)
# -I: Run Python in isolated mode (ignore PYTHONPATH, site-packages, user site-packages)
# -s: Don't add user site-packages to sys.path
# -E: Ignore PYTHON* environment variables
exec /usr/bin/python3.11 -I -s -E "$@"
