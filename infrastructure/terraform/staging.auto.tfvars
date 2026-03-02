# Staging environment overrides
# Auto-loaded by Terraform (*.auto.tfvars)

environment = "staging"

# Staging-appropriate sizing
db_instance_class    = "db.t3.micro"
api_desired_count    = 1
finn_desired_count   = 1
dixie_desired_count  = 1
gateway_desired_count = 1
nats_desired_count   = 1
pgbouncer_desired_count = 1
ingestor_desired_count  = 1
gp_worker_desired_count = 1

# VPC — matches existing staging VPC (10.1.0.0/16)
vpc_cidr = "10.1.0.0/16"
