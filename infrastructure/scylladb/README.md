# ScyllaDB Cloud Serverless Setup

Sprint S-3 documentation for ScyllaDB Cloud Serverless configuration.

## Account Setup (S-3.1)

### Prerequisites

1. Create ScyllaDB Cloud account at https://cloud.scylladb.com
2. Choose **Serverless** tier (pay-per-operation)
3. Select region closest to your EKS cluster (us-east-1 recommended)

### Connection Bundle

1. Download the secure connect bundle from ScyllaDB Cloud dashboard
2. Store in AWS Secrets Manager:
   ```bash
   aws secretsmanager create-secret \
     --name arrakis/scaling/scylla \
     --secret-string '{"SCYLLA_BUNDLE_PATH":"/secrets/scylla-bundle.zip","SCYLLA_USERNAME":"arrakis","SCYLLA_PASSWORD":"<password>"}'
   ```

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SCYLLA_CLOUD_BUNDLE` | Path to secure connect bundle | `/secrets/scylla-bundle.zip` |
| `SCYLLA_USERNAME` | Database username | `arrakis` |
| `SCYLLA_PASSWORD` | Database password | `<from secrets>` |
| `SCYLLA_KEYSPACE` | Target keyspace | `arrakis` |
| `SCYLLA_LOCAL_DC` | Local datacenter for consistency | `aws-us-east-1` |

## Cost Estimation

| Operation | Price (per million) | Monthly Estimate |
|-----------|---------------------|------------------|
| Writes | $0.75 | ~$30-50 |
| Reads | $0.25 | ~$50-80 |
| Storage | $0.25/GB | ~$10-20 |
| **Total** | | **~$100/month** |

## Schema Deployment

Run the schema migration:

```bash
cd infrastructure/scylladb
./deploy-schema.sh
```

## Health Check

```bash
# Verify connection
node -e "require('./test-connection.js')"
```

## Monitoring

ScyllaDB Cloud provides built-in monitoring at:
- Dashboard: https://cloud.scylladb.com/clusters/{cluster-id}/monitoring
- Prometheus endpoint available for external scraping

## Troubleshooting

### Connection Issues

1. Verify bundle is accessible at configured path
2. Check credentials in Secrets Manager
3. Ensure VPC peering or PrivateLink is configured
4. Verify security group allows outbound to ScyllaDB endpoints

### Performance Issues

1. Check partition key distribution (avoid hot partitions)
2. Review consistency levels (LOCAL_QUORUM recommended)
3. Monitor read/write latencies in ScyllaDB Cloud dashboard
