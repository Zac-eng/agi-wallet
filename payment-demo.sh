#!/bin/sh

curl -X POST localhost:3000/v1/charge -H "Authorization: Bearer $API_KEY" -d '{"amount": 10, "merchantId": "merchant1"}'