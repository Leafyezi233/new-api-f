package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestDirectGroupTokenPriceChargesWalletAndTokenOnChatStream(t *testing.T) {
	h := newRelayHarness(t)
	require.NoError(t, model.DB.AutoMigrate(&model.SystemTask{}))
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = previousOptions })
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error { saved[key] = value; return nil }))
	usableGroups := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(usableGroups))
		billing_setting.PublishDirectGroupPricing(nil)
	})
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"general_setting.quota_display_type":            "CUSTOM",
		"general_setting.custom_currency_symbol":        "¥",
		"general_setting.custom_currency_exchange_rate": "1",
		"group_ratio_setting.group_ratio":               `{"default":2,"vip":3}`,
	}))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","vip":"VIP"}`))
	channel := h.newChannel(constant.ChannelTypeOpenAI, "sk-synthetic")
	channel.Group = "default,vip"
	h.install(t, channel)
	stream := strings.Replace(relayTestBody, `"max_tokens"`, `"stream":true,"stream_options":{"include_usage":true},"max_tokens"`, 1)

	run := func(group string) relayOutcome {
		require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", h.tokenID).Update("group", group).Error)
		var before, after model.User
		require.NoError(t, model.DB.First(&before, h.userID).Error)
		result := h.post(t, "/v1/chat/completions", stream)
		require.Equal(t, http.StatusOK, result.status, result.body)
		require.Contains(t, result.body, "data: [DONE]")
		require.NoError(t, model.DB.First(&after, h.userID).Error)
		require.Equal(t, result.quota, before.Quota-after.Quota, "wallet and token must debit the same quota")
		require.Equal(t, result.quota, result.log.Quota, "the consumption log must match the actual debit")
		return result
	}
	quotePath := "direct_group_prices." + relayTestModel
	quote := func() gjson.Result {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/pricing", nil)
		ctx.Set("id", h.userID)
		controller.GetPricing(ctx)
		require.Equal(t, http.StatusOK, recorder.Code)
		return gjson.Get(recorder.Body.String(), quotePath)
	}
	baseline := run("default").quota
	require.Positive(t, baseline)
	require.NoError(t, model.UpdateOption(billing_setting.DirectGroupTokenPricingOption, `{
  "default":{"gpt-4o-mini":{"mode":"direct","input":0.49,"output":0.95,"cache_read":0,"cache_write":0.59}},
  "vip":{"gpt-4o-mini":{"mode":"direct","input":1,"output":2,"cache_read":0,"cache_write":0.5}}
 }`))
	for _, tc := range []struct {
		group string
		quota int
	}{{"default", 1195}, {"vip", 2500}} {
		result := run(tc.group)
		require.Equal(t, tc.quota, result.quota)
		require.Equal(t, tc.group, gjson.Get(result.log.Other, "direct_price_group").String())
	}
	require.Equal(t, 0.49, quote().Get("default.input").Float())
	require.Equal(t, 1.0, quote().Get("vip.input").Float())
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	require.False(t, quote().Get("vip").Exists(), "an enabled but unauthorized group must not leak its direct price")
	require.NoError(t, model.UpdateOption(billing_setting.DirectGroupTokenPricingOption, `{"default":{"gpt-4o-mini":{"mode":"ratio"}}}`))
	require.False(t, quote().Exists(), "ratio mode removes the direct quote")
	rolledBack := run("default")
	require.Equal(t, baseline, rolledBack.quota)
	require.False(t, gjson.Get(rolledBack.log.Other, "direct_price_group").Exists())
}
