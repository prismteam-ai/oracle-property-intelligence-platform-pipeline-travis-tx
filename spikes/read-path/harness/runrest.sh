export CF_DOMAIN=dasmdsre65gli.cloudfront.net CF_KEY_PAIR_ID=K23MXSP8XO2OI1 CF_KEY_FILE=$HOME/.config/assessment/spike-cf-key.pem
npx tsx run.ts firstload-v1g-rawwasm harness/index4.html 20 0 cid/austin-proxy/v1g/part-00000.parquet
npx tsx run.ts filebase-jackson-property-range harness/br/index4.html 20 2 https://ipfs.filebase.io/ipfs/bafkreihpofotqrr7wqz2qkt7jhrzadcyalt5bax6xn3w2y45y7bx4muxci
bash runcold.sh
echo RESTDONE
