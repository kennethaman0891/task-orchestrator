#!/bin/zsh
# Start tto-web backend server

export PATH="$HOME/bin:$PATH"
cd ~/tto-web/backend
exec ~/tto-web/venv/bin/python main.py
