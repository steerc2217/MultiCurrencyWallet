import debug from 'debug'
import { util } from 'swap.app'
import { AtomicAB2UTXO } from 'swap.swap'
import { EthLikeSwap, BtcSwap } from 'swap.swaps'


interface IBtcToEthLike {
  flowName: string
  getMyAddress: Function
  getParticipantAddress: Function
}
class BtcToEthLike extends AtomicAB2UTXO {

  _flowName: string
  ethLikeSwap: EthLikeSwap
  ethLikeCoin: string
  btcSwap: BtcSwap

  state: any

  getMyAddress: Function
  getParticipantAddress: Function

  constructor(swap, options: IBtcToEthLike) {
    super(swap)

    if (!options.flowName) {
      throw new Error('BtcToEthLike - option flowName requery')
    }
    if (!options.getMyAddress || typeof options.getMyAddress !== 'function') {
      throw new Error(`BtcToEthLike ${options.flowName} - option getMyAddress - function requery`)
    }
    if (!options.getParticipantAddress || typeof options.getParticipantAddress !== 'function') {
      throw new Error(`BtcToEthLike ${options.flowName} - option getParticipantAddress - function requery`)
    }

    this.getMyAddress = options.getMyAddress
    this.getParticipantAddress = options.getParticipantAddress

    this.utxoCoin = `btc`
    this.ethLikeCoin = swap.ethLikeCoin
    this._flowName = options.flowName

    this.isUTXOSide = true
    this.isTakerMakerModel = true
    this.setupTakerMakerEvents()
    this.stepNumbers = this.getStepNumbers()

    this.ethLikeSwap = swap.ownerSwap
    this.btcSwap = swap.participantSwap

    this.abBlockchain = this.ethLikeSwap
    this.utxoBlockchain = this.btcSwap

    if (!this.ethLikeSwap) {
      throw new Error(`BTC2${this.ethLikeCoin}: "ethLikeSwap" of type object required`)
    }
    if (!this.btcSwap) {
      throw new Error(`BTC2${this.ethLikeCoin}: "btcSwap" of type object required`)
    }

    this.state = {
      step: 0,

      isStoppedSwap: false,

      signTransactionHash: null,
      isSignFetching: false,
      isParticipantSigned: false,

      ethLikeSwapCreationTransactionHash: null,

      secretHash: null,

      isBalanceFetching: false,
      isBalanceEnough: true,
      balance: null,

      isEthContractFunded: false,

      utxoSwapWithdrawTransactionHash: null,
      ethLikeSwapWithdrawTransactionHash: null,

      canCreateEthTransaction: true,
      isEthWithdrawn: false,

      refundTransactionHash: null,
      isRefunded: false,

      withdrawFee: null,
      refundTxHex: null,
      isFinished: false,
      isSwapExist: false,

      requireWithdrawFee: false,

      utxoFundError: null,
    }

    const flow = this

    if (this.isMaker()) {
      this.swap.room.once('create eth contract', async ({
        ethLikeSwapCreationTransactionHash,
      }) => {
        flow.setState({
          ethLikeSwapCreationTransactionHash,
        }, true)
      })
    }

    this._persistState()
    super._persistSteps()
  }

  _persistState() {
    super._persistState()
  }

  //@ts-ignore: strictNullChecks
  _getSteps() {
    const flow = this


    if (this.isTaker()) {
      return [

        // 1. Signs
        async () => {
          this.signUTXOSide()
        },

        // 2. Create secret, secret hash and BTC script
        () => {
          this.submitSecret()
        },

        // 3. Check balance
        () => {
          this.syncBalance()
        },

        // 4. Create BTC Script, fund, notify participant
        async () => {
          this.btcSwap.fundSwapScript({
            flow,
          })
        },

        // 5. Wait participant creates ETH Contract
        async () => {
          await flow.ethLikeSwap.waitABContract({
            flow,
            utxoCoin: `btc`,
          })
        },

        // 6. Withdraw
        async () => {
          await flow.ethLikeSwap.withdrawFromABContract({ flow })
        },

        // 7. Finish
        () => {
          flow.swap.room.once('swap finished', ({utxoSwapWithdrawTransactionHash}) => {
            flow.setState({
              utxoSwapWithdrawTransactionHash,
            })
          })

          flow.swap.room.sendMessage({
            event: 'request swap finished',
          })

          flow.finishStep({
            isFinished: true,
          }, 'finish')
        },

        // 8. Finished!
        () => {}
      ]
    } else {
      return [
        // 1 - `sign` Signs
        async () => {
          this.signUTXOSide()
        },

        // 2 - `sync-balance` - syncBalance
        async () => {
          this.syncBalance()
        },

        // 3 - `wait-lock-eth` - wait taker create AB - обмен хешем
        async () => {
          await util.helpers.repeatAsyncUntilResult(async () => {
            const isContractFunded = await this.ethLikeSwap.isContractFunded(this)
            if (isContractFunded) {
              this.finishStep({
                isEthContractFunded: true,
              }, 'wait-lock-eth`')
              return true
            }
            return false
          })
        },

        // 4 - `lock-utxo` - create UTXO
        async () => {
          // Repeat until 
          await util.helpers.repeatAsyncUntilResult(async () => {
            const {
              secretHash,
              utxoScriptValues
            } = flow.state
            if (secretHash && utxoScriptValues) {
              const isSwapCreated = await flow.ethLikeSwap.isSwapCreated({
                ownerAddress: flow.getParticipantAddress(flow.swap),
                participantAddress: flow.getMyAddress(),
                secretHash,
              })
              if (isSwapCreated) {
                const destAddressIsOk = await this.ethLikeSwap.checkTargetAddress({ flow })

                if (destAddressIsOk) {
                  await this.btcSwap.fundSwapScript({
                    flow,
                  })
                  return true
                } else {
                  console.warn('Destination address not valid. Stop swap now!')
                }
              }
            } else {
              flow.swap.room.sendMessage({
                event: 'request utxo script',
              })
              return false
            }
          })
        },

        // 5 - `wait-withdraw-utxo` - wait withdraw UTXO - fetch secret from TX - getSecretFromTxhash
        async () => {
          await util.helpers.repeatAsyncUntilResult(async () => {
            // check withdraw
            const {
              utxoScriptValues,
            } = this.state
            const { scriptAddress } = this.utxoBlockchain.createScript(utxoScriptValues)

            const utxoWithdrawData = await this.btcSwap.checkWithdraw(scriptAddress)

            if (utxoWithdrawData) {
              const {
                txid: utxoSwapWithdrawTransactionHash,
              } = utxoWithdrawData

              const secret = await this.btcSwap.getSecretFromTxhash(utxoSwapWithdrawTransactionHash)
              if (secret) {
                this.finishStep({
                  secret,
                  utxoSwapWithdrawTransactionHash,
                }, 'wait-withdraw-utxo')
              }
              return true
            } else {
              return false
            }
          })
        },

        // 6 - `withdraw-eth` - withdraw from AB
        async () => {
          await flow.ethLikeSwap.withdrawFromABContract({ flow })
        },

        // 7 - `finish`
        async () => {
          // @to-do - txids room events
          flow.finishStep({
            isFinished: true,
          }, 'finish')
        },

        // 8 - `end`
        async () => {
          
        },
      ]
    }
  }

  getBTCScriptAddress() {
    const { scriptAddress } = this.state
    return scriptAddress;
  }

  async skipSyncBalance() {
    this.finishStep({}, { step: 'sync-balance' })
  }

  getRefundTxHex = () => {
    this.btcSwap.getRefundHexTransaction({
      scriptValues: this.state.utxoScriptValues,
      secret: this.state.secret,
    })
      .then((txHex) => {
        this.setState({
          refundTxHex: txHex,
        })
      })
  }

  tryRefund() {
    const flow = this
    const { utxoScriptValues, secret } = flow.state

    return flow.btcSwap.refund({
      scriptValues: utxoScriptValues,
      secret: secret,
    })
      .then((hash) => {
        if (!hash) {
          return false
        }

        this.swap.room.sendMessage({
          event: 'utxo refund completed',
        })

        flow.setState({
          refundTransactionHash: hash,
          isRefunded: true,
          isSwapExist: false,
        }, true)

        return true
      })
      .catch((error) => {
        if (/Address is empty/.test(error)) {
          // TODO - fetch TX list to script for refund TX
          flow.setState({
            isRefunded: true,
            isSwapExist: false,
          }, true)
          return true
        } else {
          console.warn('Btc refund:', error)

          return false
        }
      })
  }

  async isRefundSuccess() {
    const { refundTransactionHash, isRefunded } = this.state
    if (refundTransactionHash && isRefunded) {
      if (await this.btcSwap.checkTX(refundTransactionHash)) {
        return true
      } else {
        console.warn('BTC2ETH - unknown refund transaction')
        this.setState( {
          refundTransactionHash: null,
          isRefunded: false,
        } )
        return false
      }
    }
    return false
  }

  async tryWithdraw(_secret) {
    const { secret, secretHash, isEthWithdrawn } = this.state

    if (!_secret)
      throw new Error(`Withdrawal is automatic. For manual withdrawal, provide a secret`)

    if (secret && secret != _secret)
      console.warn(`Secret already known and is different. Are you sure?`)

    if (isEthWithdrawn)
      console.warn(`Looks like money were already withdrawn, are you sure?`)

    debug('swap.core:flow')(`WITHDRAW using secret = ${_secret}`)

    const _secretHash = this.app.env.bitcoin.crypto.ripemd160(Buffer.from(_secret, 'hex')).toString('hex')

    if (secretHash != _secretHash)
      console.warn(`Hash does not match! state: ${secretHash}, given: ${_secretHash}`)

    const data = {
      ownerAddress: this.getParticipantAddress(this.swap),
      secret: _secret,
    }

    await this.ethLikeSwap.withdraw(data, (hash) => {
      debug('swap.core:flow')(`TX hash=${hash}`)
      this.setState({
        ethLikeSwapWithdrawTransactionHash: hash,
        canCreateEthTransaction: true,
      })
    }).then(() => {

      this.finishStep({
        isEthWithdrawn: true,
      }, 'withdraw-eth')
    })
  }
}

export default BtcToEthLike
