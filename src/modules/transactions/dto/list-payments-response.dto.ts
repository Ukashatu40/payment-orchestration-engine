// src/modules/transactions/dto/list-payments-response.dto.ts

import { PaymentResponseDto } from './payment-response.dto';

export interface ListPaymentsResponseDto {
  data: PaymentResponseDto[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
