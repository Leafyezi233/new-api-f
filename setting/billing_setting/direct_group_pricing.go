package billing_setting

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

const DirectGroupTokenPricingOption = "DirectGroupTokenPricing"

// DirectTokenPrices are site yuan per million tokens, without any markup.
// Longer cache lifetimes use the same explicit write price in this mode.
type DirectTokenPrices struct {
	Input      float64 `json:"input"`
	Output     float64 `json:"output"`
	CacheRead  float64 `json:"cache_read"`
	CacheWrite float64 `json:"cache_write"`
}

type directTokenPriceDraft struct {
	Mode       string   `json:"mode"`
	Input      *float64 `json:"input"`
	Output     *float64 `json:"output"`
	CacheRead  *float64 `json:"cache_read"`
	CacheWrite *float64 `json:"cache_write"`
}

type DirectGroupPricing map[string]map[string]DirectTokenPrices

var directGroupPricing atomic.Pointer[DirectGroupPricing]

// ParseDirectGroupPricing validates the entire settings draft before it is saved.
func ParseDirectGroupPricing(raw string) (DirectGroupPricing, error) {
	var draft map[string]map[string]directTokenPriceDraft
	if err := common.UnmarshalJsonStr(raw, &draft); err != nil || draft == nil {
		return nil, common.NewMessage("Direct group pricing must be a JSON object")
	}
	prices := make(DirectGroupPricing)
	for group, models := range draft {
		if group == "" || group == "auto" || group == "all" || strings.TrimSpace(group) != group || models == nil {
			return nil, common.NewMessage("Direct pricing requires a fixed group")
		}
		for model, row := range models {
			if model == "" || strings.TrimSpace(model) != model || strings.Contains(model, "*") {
				return nil, common.NewMessage("Direct pricing requires an exact model name")
			}
			switch row.Mode {
			case "ratio":
				if row.Input != nil || row.Output != nil || row.CacheRead != nil || row.CacheWrite != nil {
					return nil, common.NewMessage("Multiplier mode cannot specify direct prices")
				}
				continue
			case "direct":
				for _, v := range []*float64{row.Input, row.Output, row.CacheRead, row.CacheWrite} {
					if v == nil || *v < 0 || math.IsNaN(*v) || math.IsInf(*v, 0) || *v > float64(common.MaxQuota) {
						return nil, common.NewMessage("Direct prices must all be present, nonnegative, and within the supported range")
					}
				}
			default:
				return nil, common.NewMessage("Choose direct pricing or multiplier pricing")
			}
			if prices[group] == nil {
				prices[group] = make(map[string]DirectTokenPrices)
			}
			prices[group][model] = DirectTokenPrices{*row.Input, *row.Output, *row.CacheRead, *row.CacheWrite}
		}
	}
	return prices, nil
}

func PublishDirectGroupPricing(prices DirectGroupPricing) {
	directGroupPricing.Store(&prices)
}

func GetDirectTokenPrices(group, model string) (DirectTokenPrices, bool) {
	if prices := directGroupPricing.Load(); prices != nil {
		row, ok := (*prices)[group][model]
		return row, ok
	}
	return DirectTokenPrices{}, false
}

// DirectPricingUsesYuanQuota prevents interpreting existing USD quota as yuan.
func DirectPricingUsesYuanQuota() bool {
	setting := operation_setting.GetGeneralSetting()
	return setting.QuotaDisplayType == operation_setting.QuotaDisplayTypeCustom &&
		(setting.CustomCurrencySymbol == "¥" || setting.CustomCurrencySymbol == "￥") && setting.CustomCurrencyExchangeRate == 1
}

// AllowsDirectTokenPrice keeps existing request-priced models (including mixed expressions) on their existing billing path.
func AllowsDirectTokenPrice(hasModelPrice bool, billingExpr string) bool {
	return !hasModelPrice && (billingExpr == "" || !billingexpr.UsesFixedPricing(billingExpr))
}

func (p DirectTokenPrices) Expression() string {
	price := func(n float64) string { return strconv.FormatFloat(n, 'f', -1, 64) }
	write := price(p.CacheWrite)
	return fmt.Sprintf(`tier("direct", p * %s + c * %s + cr * %s + cc * %s + cc1h * %s + cc12h * %s)`,
		price(p.Input), price(p.Output), price(p.CacheRead), write, write, write)
}
