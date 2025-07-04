#!/bin/bash
cd /home/kavia/workspace/code-generation/artquest-107018-7bbab8d7/react_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

