import { BigNumber } from 'bignumber.js'
import { FormattedMessage } from 'react-intl'
import CSSModules from 'react-css-modules'
import styles from './index.scss'
import { BlockReasons, Actions } from './types'
import { API_NAME } from './constants'

function Feedback(props) {
  const {
    network,
    isSourceMode,
    blockReason,
    baseChainWallet,
    spendedAmount,
    insufficientBalance,
    wrongNetwork,
    needApproveA,
    needApproveB,
    spendedCurrency,
    receivedCurrency,
    error,
    sourceAction,
  } = props

  return (
    <section>
      {!isSourceMode && !API_NAME[network?.networkVersion] ? (
        <p styleName="dangerousNotice">
          <FormattedMessage
            id="aggregatorCannotUseThisNetwork"
            defaultMessage="Aggregator cannot use this network. Please choose another"
          />
        </p>
      ) : wrongNetwork ? (
        <p styleName="dangerousNotice">
          <FormattedMessage id="incorrectNetwork" defaultMessage="Please choose correct network" />
        </p>
      ) : blockReason === BlockReasons.PairDoesNotExist &&
        isSourceMode &&
        sourceAction !== Actions.AddLiquidity ? (
        <p styleName="neutralNotice">
          <FormattedMessage
            id="liquidityPairDoesNotExist"
            defaultMessage="This pair does not have liquidity. You can create a new one and be the first liquidity provider"
          />
        </p>
      ) : !spendedAmount ? (
        <p styleName="neutralNotice">
          <FormattedMessage id="enterYouSend" defaultMessage='Enter "You send" amount' />
        </p>
      ) : new BigNumber(baseChainWallet?.balance).isEqualTo(0) ? (
        <p styleName="warningNotice">
          <FormattedMessage
            id="doNotHaveNativeCurrencyBalance"
            defaultMessage="You do not have native currency balance to pay the transaction fee"
          />
        </p>
      ) : insufficientBalance ? (
        <p styleName="warningNotice">
          <FormattedMessage
            id="AlertOrderNonEnoughtBalance"
            defaultMessage="Please top up your balance before you start the swap"
          />
        </p>
      ) : needApproveA && needApproveB && sourceAction === Actions.AddLiquidity ? (
        <p styleName="warningNotice">
          <FormattedMessage
            id="approveBothTokens"
            defaultMessage="Please approve both tokens first"
          />
        </p>
      ) : needApproveA ? (
        <p styleName="warningNotice">
          <FormattedMessage
            id="approveTokenFirst"
            defaultMessage="Please approve {token} first"
            values={{ token: spendedCurrency.name }}
          />
        </p>
      ) : needApproveB && sourceAction === Actions.AddLiquidity ? (
        <p styleName="warningNotice">
          <FormattedMessage
            id="approveTokenFirst"
            defaultMessage="Please approve {token} first"
            values={{ token: receivedCurrency.name }}
          />
        </p>
      ) : blockReason === BlockReasons.InsufficientSlippage ? (
        <p styleName="warningNotice">
          <FormattedMessage
            id="insufficientSlippage"
            defaultMessage="Insufficient slippage. Try to increase it"
          />
        </p>
      ) : blockReason === BlockReasons.NoLiquidity ? (
        <p styleName="neutralNotice">
          <FormattedMessage
            id="insufficientLiquidity"
            defaultMessage="Insufficient pool liquidity"
          />
        </p>
      ) : blockReason === BlockReasons.Liquidity ? (
        <p styleName="neutralNotice">
          <FormattedMessage
            id="liquidityPoolProblem"
            defaultMessage="There is some problem with liquidity pool. Try to exchange with a Source section"
          />
        </p>
      ) : blockReason === BlockReasons.Unknown ? (
        <p styleName="dangerousNotice">
          <FormattedMessage
            id="unknownSwapProblemHasOccurred"
            defaultMessage="Unknown problem has occurred"
          />
        </p>
      ) : null}

      {error && <pre styleName="dangerousNotice">{error?.message}</pre>}
    </section>
  )
}

export default CSSModules(Feedback, styles, { allowMultiple: true })
