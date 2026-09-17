// src/modules/gateways/repositories/gateway-config.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { GatewayConfig } from '../entities/gateway-config.entity';
import { PaymentGateway, PaymentMethod } from '../../../common/enums';

@Injectable()
export class GatewayConfigRepository {
  private readonly repo: Repository<GatewayConfig>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(GatewayConfig);
  }

  async findAll(): Promise<GatewayConfig[]> {
    return this.repo.find();
  }

  async findByGateway(gateway: PaymentGateway): Promise<GatewayConfig | null> {
    return this.repo.findOne({ where: { gateway } });
  }

  async findEnabledForMethodAndCurrency(
    paymentMethod: PaymentMethod,
    currency: string,
  ): Promise<GatewayConfig[]> {
    return this.repo
      .createQueryBuilder('gc')
      .where('gc.is_enabled = TRUE')
      .andWhere(':method = ANY(gc.supported_methods)', { method: paymentMethod })
      .andWhere(':currency = ANY(gc.supported_currencies)', { currency })
      .getMany();
  }

  async updateConfig(gateway: PaymentGateway, updates: Partial<GatewayConfig>): Promise<void> {
    await this.repo.update({ gateway }, updates as any);
  }
}
