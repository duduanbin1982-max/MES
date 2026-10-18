#!/usr/bin/env bash
# scripts/pki-issue.sh —— 内网 CA + MES 服务端证书（P0-A1，2026-10-18）
#
# 目的：把自签证书换成**由内网 CA 签发**的证书，客户端只需信任一次根 CA，
#       之后所有浏览器/爬虫/客户端都显示"安全"，不再每次报警告。
#
# 设计：
#   - 私钥只落本机 /home/dubin/pki（700/600），**绝不入库**
#   - 服务端证书有效期 397 天（< 398 天，兼容 Chrome/Edge 的最长期限策略）
#   - SAN 覆盖：tbm.lan / mes.tbm.lan / erp.tbm.lan / localhost / 192.168.1.73 / 127.0.0.1
#   - 幂等：CA 已存在则复用（不重新生成，避免客户端已信任的根失效）
#   - 产出：ssl/cert.pem（服务端证书+CA 链）、ssl/key.pem、ssl/tbm-root-ca.crt/.cer
#
# 用法：
#   sudo bash scripts/pki-issue.sh            # 首次签发 / 重新签发服务端证书
#   sudo bash scripts/pki-issue.sh --ca-only  # 只建 CA
#   续期：直接再跑一次（会覆盖 cert.pem/key.pem，nginx reload 后生效）
set -euo pipefail

ROOT="/home/dubin/factory-mes"
PKI_DIR="${PKI_DIR:-/home/dubin/pki}"
CA_DIR="$PKI_DIR/ca"
SRV_DIR="$PKI_DIR/server"
SSL_DIR="$ROOT/ssl"
STAMP="$(date +%Y%m%d_%H%M%S)"

SUBJ_CA="/C=CN/ST=Hubei/L=Ezhou/O=TBM Factory/CN=TBM Internal CA"
SUBJ_SRV="/C=CN/ST=Hubei/L=Ezhou/O=TBM Factory/CN=tbm.lan"
DAYS_CA="${DAYS_CA:-3650}"
DAYS_SRV="${DAYS_SRV:-397}"
SAN="DNS:tbm.lan,DNS:mes.tbm.lan,DNS:erp.tbm.lan,DNS:localhost,IP:192.168.1.73,IP:127.0.0.1"

log() { echo "[pki] $*"; }

mkdir -p "$CA_DIR" "$SRV_DIR" "$SSL_DIR"
chmod 700 "$PKI_DIR" "$CA_DIR" "$SRV_DIR"

# ---------------------------------------------------------------- 1) 根 CA（幂等）
if [ ! -f "$CA_DIR/ca.key" ] || [ ! -f "$CA_DIR/ca.crt" ]; then
  log "生成根 CA（$DAYS_CA 天）"
  openssl req -x509 -newkey rsa:4096 -nodes -sha256 \
    -keyout "$CA_DIR/ca.key" -out "$CA_DIR/ca.crt" \
    -days "$DAYS_CA" -subj "$SUBJ_CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  chmod 600 "$CA_DIR/ca.key"
else
  log "复用已有根 CA：$(openssl x509 -in "$CA_DIR/ca.crt" -noout -subject | sed 's/subject=//')"
fi

# ---------------------------------------------------------------- 2) 服务端证书
EXT_FILE="$SRV_DIR/server.ext"
cat > "$EXT_FILE" <<EOF
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = $SAN
EOF

log "生成服务端私钥 + CSR"
openssl req -newkey rsa:3072 -nodes -sha256 \
  -keyout "$SRV_DIR/server.key" -out "$SRV_DIR/server.csr" \
  -subj "$SUBJ_SRV" 2>/dev/null
chmod 600 "$SRV_DIR/server.key"

log "用内网 CA 签发服务端证书（$DAYS_SRV 天）"
openssl x509 -req -in "$SRV_DIR/server.csr" \
  -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
  -out "$SRV_DIR/server.crt" -days "$DAYS_SRV" -sha256 -extfile "$EXT_FILE" 2>/dev/null

# ---------------------------------------------------------------- 3) 部署到 nginx 目录（先备份旧证书）
for f in cert.pem key.pem; do
  if [ -f "$SSL_DIR/$f" ]; then cp -a "$SSL_DIR/$f" "$SSL_DIR/$f.selfsigned.$STAMP"; fi
done
cat "$SRV_DIR/server.crt" "$CA_DIR/ca.crt" > "$SSL_DIR/cert.pem"
cp "$SRV_DIR/server.key" "$SSL_DIR/key.pem"
chmod 644 "$SSL_DIR/cert.pem"
chmod 600 "$SSL_DIR/key.pem"
cp "$CA_DIR/ca.crt" "$SSL_DIR/tbm-root-ca.crt"
openssl x509 -in "$CA_DIR/ca.crt" -outform DER -out "$SSL_DIR/tbm-root-ca.cer"

# ---------------------------------------------------------------- 4) 自检
log "服务端证书：$(openssl x509 -in "$SSL_DIR/cert.pem" -noout -subject -issuer -dates | tr '\n' ' | ')"
log "SAN：$(openssl x509 -in "$SSL_DIR/cert.pem" -noout -ext subjectAltName | tail -1 | xargs)"
log "链校验：$(openssl verify -CAfile "$CA_DIR/ca.crt" "$SRV_DIR/server.crt" 2>&1)"
log "根 CA 分发文件：$SSL_DIR/tbm-root-ca.crt / .cer"
log "完成。下一步：nginx -t && systemctl reload nginx"
