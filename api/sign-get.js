  //api/sign-get.js
  ------------------------------------------------
  import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
  import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

  export default async function handler(req, res){
    const { password, key } = req.query||{};
    if(!password || password !== process.env.APP_PASSWORD) return res.status(401).send("Unauthorized");
    if(!key) return res.status(400).send("key required");

    const client = new S3Client({ region: process.env.AWS_REGION, credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }});

    const bucket = process.env.S3_BUCKET;
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const url = await getSignedUrl(client, command, { expiresIn: 60 });
    res.status(200).json({ url });
  }

  // Vercel 環境変数に設定: APP_PASSWORD, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET
  // package.json に以下を追加: "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"
  // IAMは対象バケットへの s3:PutObject / s3:GetObject を許可（最小権限）
