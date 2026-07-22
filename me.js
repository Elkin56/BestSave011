{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "api/export.js": { "maxDuration": 60 },
    "api/media.js": { "maxDuration": 30 }
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
