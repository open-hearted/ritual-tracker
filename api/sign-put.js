  <!-- ====== Vercel Serverless Functions: /api/sign-put.js & /api/sign-get.js ======
  コピーしてリポジトリに配置してください。

  /api/sign-put.js
  ------------------------------------------------
  import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
  import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

  export default async function handler(req, res){
    if(req.method!=="POST") return res.status(405).send("Method Not Allowed");
    const { password, key, contentType } = req.body||{};
    if(!password || password !== process.env.APP_PASSWORD) return res.status(401).send("Unauthorized");
    if(!key) return res.status(400).send("key required");

    const client = new S3Client({ region: process.env.AWS_REGION, credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }});

    const bucket = process.env.S3_BUCKET;
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType||"application/octet-stream" });
    const url = await getSignedUrl(client, command, { expiresIn: 60 }); // 60秒
    res.status(200).json({ url });
  }
