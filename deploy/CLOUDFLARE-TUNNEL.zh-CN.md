# QuoteMint 经 Cloudflare 隧道部署（中文翻译版）

> [English](CLOUDFLARE-TUNNEL.md) | 中文 · 参考译文；当前生产实际走 Netlify + Neon（见 README「当前线上」），本文档为将来迁移存档。

目标：https://quotemint.dpdns.org -> http://127.0.0.1:3000。不开放任何入站端口，无需 ICP 备案。

## 1. 把域名接入 Cloudflare（一次性操作）

1. dash.cloudflare.com -> Add a site -> 你的 dpdns.org 子域名（例如 quotemint.dpdns.org）-> Free plan。
2. Cloudflare 会显示两个 nameserver。到 dashboard.digitalplat.org，把该域名的 NS 记录设置为这两个。
3. 等待 zone 状态变为 Active（几分钟到几小时）。

## 2. 在服务器上安装 cloudflared（Cloudflare 官方软件源，中国大陆可访问）

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
cloudflared --version
```

## 3. 授权并创建隧道

```bash
sudo cloudflared tunnel login
# 在浏览器中打开打印出的 URL，选择 quotemint 这个 zone，点击 Authorize。
# 无图形界面的服务器：浏览器会下载 cert.pem；把它复制到 /root/.cloudflared/cert.pem
sudo cloudflared tunnel create quotemint
# 会打印出一个隧道 UUID。凭据文件：/root/.cloudflared/<UUID>.json
```

## 4. 把 DNS 路由到隧道

```bash
sudo cloudflared tunnel route dns quotemint quotemint.dpdns.org
```

## 5. 作为服务运行

```bash
sudo mkdir -p /etc/cloudflared
sudo tee /etc/cloudflared/config.yml >/dev/null <<'EOF'
tunnel: quotemint
credentials-file: /root/.cloudflared/<UUID>.json
ingress:
  - hostname: quotemint.dpdns.org
    service: http://127.0.0.1:3000
  - service: http_status:404
EOF
# 把 <UUID> 替换为第 3 步中得到的值。
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

## 6. 验证

```bash
curl -I https://quotemint.dpdns.org/healthz        # 预期：HTTP/2 200
systemctl status cloudflared --no-pager
journalctl -u cloudflared -n 20 --no-pager
```

## 备注

- 应用的 .env 中已设置 TRUST_PROXY=1，因此限流能看到真实的客户端 IP。
- 全程只使用出站连接；服务器的防火墙保持关闭。
- BASE_URL 必须是 https://quotemint.dpdns.org（报价链接基于它生成）。
