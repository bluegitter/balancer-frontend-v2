import { getAddress } from '@ethersproject/address';
import { formatUnits } from 'ethers/lib/utils';
import { intersection } from 'lodash';
import { QueryObserverResult, RefetchOptions } from 'react-query';
import { computed, ComputedRef, reactive, Ref, ref } from 'vue';
import { useQuery } from 'vue-query';

import { LiquidityGauge as TLiquidityGauge } from '@/components/contextual/pages/pools/types';
import useGraphQuery, { subgraphs } from '@/composables/queries/useGraphQuery';
import usePoolsQuery from '@/composables/queries/usePoolsQuery';
import useUserPoolsQuery from '@/composables/queries/useUserPoolsQuery';
import { isL2 } from '@/composables/useNetwork';
import { POOLS } from '@/constants/pools';
import { bnum } from '@/lib/utils';
import { getBptBalanceFiatValue } from '@/lib/utils/balancer/pool';
import { LiquidityGauge } from '@/services/balancer/contracts/contracts/liquidity-gauge';
import { DecoratedPoolWithShares } from '@/services/balancer/subgraph/types';
import useWeb3 from '@/services/web3/useWeb3';

import { getGaugeAddress } from './staking.provider';
export type UserGuageShare = {
  id: string;
  gauge: {
    poolId: string;
  };
  balance: string;
};

export type UserLiquidityGauge = {
  id?: string;
  poolId: string;
  shares: {
    balance: string;
  }[];
};

export type UserGuageSharesResponse = {
  gaugeShares: UserGuageShare[];
  liquidityGauges: UserLiquidityGauge[];
};

export type PoolStakingDataResponse = {
  liquidityGauge: UserLiquidityGauge;
};

export type UserStakingDataResponse = {
  // a list of the gauge shares owned by that user
  // a gauge share represents the amount of staked
  // BPT a user has in a pool, given balance >= 0
  userGaugeShares: ComputedRef<UserGuageShare[]>;
  // a list of eligible gauges the user can stake into
  // this list is pulled against the users invested
  // pool ids
  userLiquidityGauges: ComputedRef<TLiquidityGauge[]>;
  // the amount of staked shares a user has for the
  // provided pool address to this instance, if there
  // is one. otherwise 0
  stakedSharesForProvidedPool: Ref<string>;
  // a list of pools the user has a stake in
  stakedPools: Ref<DecoratedPoolWithShares[]>;
  // Total fiat value of all staked pools for user
  totalStakedFiatValue: Ref<string>;
  // loading flag for pulling actual pool data for the
  // staked pools, not to be confused with isLoadingUserStakingData
  // which is the flag for pulling gauge data
  isLoadingStakedPools: Ref<boolean>;
  isUserStakeDataIdle: Ref<boolean>;
  isLoadingUserStakingData: Ref<boolean>;
  isLoadingStakedShares: Ref<boolean>;
  isStakedSharesIdle: Ref<boolean>;
  isRefetchingStakedShares: Ref<boolean>;
  isStakedPoolsQueryEnabled: Ref<boolean>;
  isLoadingUserPools: Ref<boolean>;
  isUserPoolsIdle: Ref<boolean>;
  refetchStakedShares: Ref<() => void>;
  isStakingQueryEnabled: Ref<boolean>;
  getStakedShares: () => Promise<string>;
  refetchUserStakingData: Ref<
    (options?: RefetchOptions) => Promise<QueryObserverResult>
  >;
  stakedSharesMap: Ref<Record<string, string>>;
};

export default function useUserStakingData(
  poolAddress: Ref<string>
): UserStakingDataResponse {
  /** COMPOSABLES */
  const { account, getProvider } = useWeb3();

  /**
   * QUERIES
   */
  const {
    data: userPoolsResponse,
    isLoading: isLoadingUserPools,
    isIdle: isUserPoolsIdle
  } = useUserPoolsQuery();

  /** QUERY ARGS */
  const userPools = computed(() => userPoolsResponse.value?.pools || []);
  const isStakingQueryEnabled = computed(() => !isL2.value);
  const isStakedSharesQueryEnabled = computed(
    () => !!poolAddress.value && poolAddress.value != ''
  );
  const stakeableUserPoolIds = computed(() =>
    intersection(userPoolIds.value, POOLS.Stakable.AllowList)
  );
  const userPoolIds = computed(() => {
    return userPools.value.map(pool => pool.id);
  });

  const {
    data: stakingData,
    isLoading: isLoadingUserStakingData,
    isIdle: isUserStakeDataIdle,
    refetch: refetchUserStakingData
  } = useGraphQuery<UserGuageSharesResponse>(
    subgraphs.gauge,
    ['staking', 'data', { account, userPoolIds }],
    () => ({
      gaugeShares: {
        __args: {
          where: { user: account.value.toLowerCase(), balance_gt: '0' }
        },
        balance: 1,
        gauge: {
          poolId: 1
        }
      },
      liquidityGauges: {
        __args: {
          where: {
            poolId_in: stakeableUserPoolIds.value
          }
        },
        poolId: true
      }
    }),
    reactive({
      refetchOnWindowFocus: false,
      enabled: isStakingQueryEnabled
    })
  );

  // we pull staked shares for a specific pool manually do to the
  // fact that the subgraph is too slow, so we gotta rely on the
  // contract. We want users to receive instant feedback that their
  // staked balances are updated
  const {
    data: stakedSharesResponse,
    isLoading: isLoadingStakedShares,
    isIdle: isStakedSharesIdle,
    isRefetching: isRefetchingStakedShares,
    refetch: refetchStakedShares
  } = useQuery<string>(
    ['staking', 'pool', 'shares'],
    () => getStakedShares(),
    reactive({
      enabled: isStakedSharesQueryEnabled,
      refetchOnWindowFocus: false
    })
  );

  /**
   * COMPUTED
   * Need to wrap the extracted query response vars into
   * computed properties so they retain reactivity
   * when returned by this composable
   */
  const stakedSharesForProvidedPool = computed(
    () => stakedSharesResponse.value || '0'
  );

  const userGaugeShares = computed(() => {
    if (!stakingData.value?.gaugeShares) return [];
    return stakingData.value.gaugeShares;
  });

  const userLiquidityGauges = computed(() => {
    if (!stakingData.value?.liquidityGauges) return [];
    return stakingData.value.liquidityGauges;
  });

  const stakedSharesMap = computed(() => {
    return Object.fromEntries(
      userGaugeShares.value.map(gaugeShare => [
        gaugeShare.gauge.poolId,
        gaugeShare.balance
      ])
    );
  });

  /** QUERY */
  const stakedPoolIds = computed(() => {
    if (isLoadingUserStakingData.value || !userGaugeShares.value) return [];
    return userGaugeShares.value.map(share => {
      return share.gauge.poolId;
    });
  });
  const isStakedPoolsQueryEnabled = computed(
    () => stakedPoolIds.value.length > 0
  );

  const {
    data: stakedPoolsResponse,
    isLoading: isLoadingStakedPools
  } = usePoolsQuery(
    ref([]),
    reactive({
      enabled: isStakedPoolsQueryEnabled
    }),
    {
      poolIds: stakedPoolIds,
      pageSize: 999
    }
  );

  const stakedPools = computed<DecoratedPoolWithShares[]>(() => {
    const decoratedPools = (
      stakedPoolsResponse.value?.pages[0].pools || []
    ).map(pool => {
      const stakedBpt = stakedSharesMap.value[pool.id];
      return {
        ...pool,
        shares: getBptBalanceFiatValue(pool, stakedBpt),
        bpt: stakedBpt
      };
    });
    return decoratedPools;
  });

  const totalStakedFiatValue = computed((): string =>
    stakedPools.value
      .reduce((acc, { shares }) => acc.plus(shares), bnum(0))
      .toString()
  );

  /** METHODS */
  async function getStakedShares() {
    if (!poolAddress.value) {
      throw new Error(
        `Attempted to get staked shares, however useStaking was initialised without a pool address.`
      );
    }
    const gaugeAddress = await getGaugeAddress(
      getAddress(poolAddress.value),
      getProvider()
    );
    const gauge = new LiquidityGauge(gaugeAddress, getProvider());
    const balance = await gauge.balance(account.value);
    return formatUnits(balance.toString(), 18);
  }

  return {
    userGaugeShares,
    userLiquidityGauges,
    stakedSharesForProvidedPool,
    isLoadingUserStakingData,
    isLoadingStakedPools,
    isLoadingStakedShares,
    isUserStakeDataIdle,
    isStakedSharesIdle,
    isRefetchingStakedShares,
    refetchStakedShares,
    isStakedPoolsQueryEnabled,
    isLoadingUserPools,
    isUserPoolsIdle,
    isStakingQueryEnabled,
    stakedSharesMap,
    refetchUserStakingData,
    stakedPools,
    totalStakedFiatValue,
    getStakedShares
  };
}
