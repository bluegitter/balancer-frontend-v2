import LiquidityGaugeAbi from '@/lib/abi/LiquidityGaugeV5.json';
import { Multicaller } from '@/lib/utils/balancer/contract';
import { configService } from '@/services/config/config.service';
import { rpcProviderService } from '@/services/rpc-provider/rpc-provider.service';
import { Contract } from '@ethersproject/contracts';

export class LiquidityGauge {
  instance: Contract;

  constructor(
    public readonly address: string,
    private readonly abi = LiquidityGaugeAbi,
    private readonly provider = rpcProviderService.jsonProvider,
    private readonly config = configService
  ) {
    this.instance = new Contract(this.address, this.abi, this.provider);
  }

  private getMulticaller(): Multicaller {
    return new Multicaller(this.config.network.key, this.provider, this.abi);
  }
}